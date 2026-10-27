// PXD-11 session calls for attribute lanes: bind a lane section to a Name:: attribute, stop, and pull blocks that have
// that attribute into it. Nothing runs on open or on a timer. Writes happen on these calls and on a card drop
// (commitMove in session.js); card positions are never derived from values after the bind.
import { DEFAULT_SIZES, FIT_PAD, lookForNewString, serializeItemLayout } from "./model/schema.js";
import { tableRows } from "./model/table.js";
import { readBinding } from "./model/bucket.js";
import { followCardString } from "./model/follow.js";
import {
  LANE_GAP,
  LANE_PAD,
  arrangeLane,
  bandIndexAt,
  bandOfRow,
  bandRect,
  growLane,
  laneAttrOk,
  laneBands,
  laneFields,
  laneRows,
  newLaneValues,
  serializeBands,
  shownBands,
  snapIntoBand,
  valueKey,
} from "./model/attr-lanes.js";
import { extendSession } from "./session.js";
import { SPREAD_CAP } from "./session-clip.js";

// Attribute blocks of a name: they ref the attribute page. Page-level attribute blocks (parent is a page) are skipped.
const ATTR_BLOCKS = "[:find ?pu ?s ?o :in $ ?title :where [?p :node/title ?title] [?a :block/refs ?p] [?a :block/string ?s] [?a :block/order ?o] [?par :block/children ?a] [?par :block/uid ?pu] (not [?par :node/title _])]";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

extendSession((session, api) => {
  const { host } = api;
  const boardUid = session.uid;
  const laneOf = (id) => {
    const lane = api.board()?.items.get(id);
    return lane && lane.type === "section" && lane.look === "lane" ? lane : null;
  };
  const rowsOf = (id) => laneRows(api.board(), id, api.laneKids, api.laneResolve);

  // New bands for `bands` (stored values first) without moving an old band edge: the lane grows by one old band per
  // added value, the cards in the none band move with it, and `ends` is where each band's stack ends (lane-local).
  function growWith(lane, rect, bands) {
    const n0 = shownBands(lane.laneBands).length;
    const added = Math.max(0, bands.length - n0);
    const grown = growLane({ w: rect.w, h: rect.h, axis: lane.axis, count: n0, added });
    const vertical = lane.axis === "vertical";
    const old = { x: 0, y: 0, w: rect.w, h: rect.h };
    const local = { x: 0, y: 0, w: grown.w, h: grown.h };
    const moves = [];
    const ends = bands.map(() => LANE_PAD);
    for (const row of rowsOf(lane.uid)) {
      const r = api.rects().get(row.uid);
      if (!r) continue;
      let q = { x: r.x - rect.x, y: r.y - rect.y, w: r.w, h: r.h };
      const was = bandIndexAt(old, lane.axis, n0, { x: q.x + q.w / 2, y: q.y + q.h / 2 });
      if (added && was === grown.noneIndex) {
        q = vertical ? { ...q, y: q.y + grown.shift } : { ...q, x: q.x + grown.shift };
        moves.push({ uid: row.uid, x: q.x, y: q.y });
      }
      const at = bandIndexAt(local, lane.axis, bands.length, { x: q.x + q.w / 2, y: q.y + q.h / 2 });
      ends[at] = Math.max(ends[at], vertical ? q.x + q.w + LANE_GAP : q.y + q.h + LANE_GAP);
    }
    return { ...grown, bands, moves, ends };
  }

  function writeGrow(t, id, lane, g, extra = {}) {
    for (const m of g.moves) t.props(m.uid, api.itemPlexus(m.uid, { x: api.round1(m.x), y: api.round1(m.y) }));
    const patch = { w: api.round1(Math.max(g.w, extra.w ?? 0)), h: api.round1(Math.max(g.h, extra.h ?? 0)) };
    const next = serializeBands(g.bands);
    if (!same(next, lane.laneBands)) patch.bands = next;
    t.props(id, api.itemPlexus(id, patch));
  }

  Object.assign(session, {
    // Values on the lane's cards that have no band yet (a value typed in Roam), up to the band cap.
    laneNewValues(id) {
      const lane = laneOf(id);
      if (!lane?.laneAttr) return [];
      return newLaneValues(rowsOf(id), lane.laneAttr, lane.laneBands).map(valueKey);
    },

    // One band per new value, appended before none. Old band edges stay; cards in none move with it; no value is written.
    addLaneValues(id) {
      const lane = laneOf(id);
      if (!lane?.laneAttr) return Promise.resolve(0);
      const rect = api.rects().get(id);
      const add = newLaneValues(rowsOf(id), lane.laneAttr, lane.laneBands);
      if (!rect || !add.length) return Promise.resolve(0);
      const g = growWith(lane, rect, laneBands([], lane.laneAttr, [...(lane.laneBands || []), ...add]));
      return api.txn((t) => {
        writeGrow(t, id, lane, g);
        return add.length;
      }).then((n) => n ?? 0);
    },

    // Names the lane menu offers: attributes on the board's cards plus those on the lane's ref cards' blocks.
    laneFieldsFor(id) {
      const board = api.board();
      if (!board) return [];
      return laneFields([...tableRows(board), ...(laneOf(id) ? rowsOf(id) : [])]);
    },

    // One transaction: the lane keeps `attr` and the band order, its cards are arranged into their bands, and the lane
    // grows to hold them. Text and sections inside it stay where they are.
    bindLane(id, name) {
      const lane = laneOf(id);
      const attr = typeof name === "string" ? name.trim() : "";
      if (!lane || !attr || !laneAttrOk(attr)) return Promise.resolve(false);
      // A section bound to a tag or value (PXD-10) already writes on each drop.
      if (readBinding(api.rawPlexus(id))) return Promise.resolve(false);
      const board = api.board();
      const rect = api.rects().get(id);
      if (!rect) return Promise.resolve(false);
      const rows = rowsOf(id);
      // Binding the same attribute again keeps its band order; values typed since then get bands at the end.
      const bands = laneBands(rows, attr, lane.laneAttr === attr ? lane.laneBands : []);
      const cards = rows.map((row) => {
        const r = api.rects().get(row.uid);
        return { uid: row.uid, w: r?.w ?? DEFAULT_SIZES.card.w, h: r?.h ?? DEFAULT_SIZES.card.h, band: bandOfRow(bands, row, attr) };
      });
      const arranged = arrangeLane({ w: rect.w, h: rect.h, axis: lane.axis, bands, cards });
      return api.txn((t) => {
        for (const c of arranged.cards) {
          if (!board.items.has(c.uid)) continue;
          t.props(c.uid, api.itemPlexus(c.uid, { x: api.round1(c.x), y: api.round1(c.y) }));
        }
        t.props(id, api.itemPlexus(id, { attr, bands: serializeBands(bands), w: api.round1(arranged.w), h: api.round1(arranged.h) }));
        return true;
      }).then((ok) => ok === true);
    },

    // Only the binding goes. Cards, values and everything else on the lane stay.
    unbindLane(id) {
      const lane = laneOf(id);
      if (!lane || !lane.laneAttr) return Promise.resolve(false);
      return api.txn((t) => {
        t.props(id, api.itemPlexus(id, { attr: undefined, bands: undefined }));
        return true;
      }).then((ok) => ok === true);
    },

    // Blocks in the graph that have a `Name::` child and are not on this board yet, as block-ref cards in the lane,
    // each in the band of its value. SPREAD_CAP per call (one undo). Resolves { placed, total }.
    pullLaneSource(id) {
      const none = { placed: 0, total: 0 };
      const lane = laneOf(id);
      const name = lane?.laneAttr;
      if (!lane || !name) return Promise.resolve(none);
      const board = api.board();
      const onBoard = new Set([boardUid]);
      for (const item of board.items.values()) {
        onBoard.add(item.uid);
        if (item.target?.uid) onBoard.add(item.target.uid);
      }
      const inTree = api.ix();
      let rows = [];
      try { rows = host.q?.(ATTR_BLOCKS, name) || []; } catch { rows = []; }
      const prefix = `${name}::`;
      // Every Name:: child per block in child order, so a block with two values lands in the band of its first.
      const found = new Map();
      for (const row of rows) {
        const [parent, string, order] = Array.isArray(row) ? row : [];
        if (typeof parent !== "string" || typeof string !== "string") continue;
        const text = string.trim();
        if (!text.startsWith(prefix)) continue;
        if (onBoard.has(parent) || inTree.has(parent)) continue;
        if (!found.has(parent)) found.set(parent, []);
        found.get(parent).push({ order: Number(order) || 0, value: text.slice(prefix.length).trim() });
      }
      const all = [...found.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      if (!all.length) return Promise.resolve(none);
      const batch = all.slice(0, SPREAD_CAP);
      const fake = batch.map(([uid, list]) => ({
        uid,
        attrs: list.sort((a, b) => a.order - b.order).map((v) => ({ name, value: v.value, uid: null })),
      }));
      const rect = api.rects().get(id);
      if (!rect) return Promise.resolve(none);
      const size = {
        w: Number(api.setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w,
        h: Number(api.setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h,
      };
      const g = growWith(lane, rect, laneBands(fake, name, lane.laneBands));
      const vertical = lane.axis === "vertical";
      const local = { x: 0, y: 0, w: g.w, h: g.h };
      let needW = g.w;
      let needH = g.h;
      // Each pulled card centered in its value's band (the band size never changes), stacked after what that band holds.
      const spots = fake.map((row) => {
        const at = bandOfRow(g.bands, row, name);
        const band = bandRect(local, lane.axis, g.bands.length, at);
        const box = { x: band.x + (band.w - size.w) / 2, y: band.y + (band.h - size.h) / 2, w: size.w, h: size.h };
        const snap = snapIntoBand(band, lane.axis, box, local, FIT_PAD);
        const cross = g.ends[at];
        g.ends[at] = cross + (vertical ? size.w : size.h) + LANE_GAP;
        const spot = vertical ? { uid: row.uid, x: cross, y: box.y + snap.dy } : { uid: row.uid, x: box.x + snap.dx, y: cross };
        needW = Math.max(needW, spot.x + size.w + LANE_PAD);
        needH = Math.max(needH, spot.y + size.h + LANE_PAD);
        return spot;
      });
      return api.txn((t) => {
        writeGrow(t, id, lane, g, vertical ? { w: needW } : { h: needH });
        const ids = spots.map((spot) => {
          const string = followCardString({ kind: "block", uid: spot.uid });
          const layout = { x: api.round1(spot.x), y: api.round1(spot.y) };
          const look = lookForNewString(string, api.setting("default-card-look", "block"));
          if (look) layout.look = look;
          return t.create({ parent: id, string, plexus: serializeItemLayout(layout) });
        });
        api.applyFit(t, ids);
        return ids.length;
      }).then((placed) => ({ placed: placed ?? 0, total: all.length }));
    },
  });
});
