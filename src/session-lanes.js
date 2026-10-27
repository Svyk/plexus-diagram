// PXD-11 session calls for attribute lanes: bind a lane section to a Name:: attribute, stop, and pull blocks that have
// that attribute into it. Nothing runs on open or on a timer. Writes happen on these calls and on a card drop
// (commitMove in session.js); card positions are never derived from values after the bind.
import { DEFAULT_SIZES, lookForNewString, serializeItemLayout } from "./model/schema.js";
import { tableRows } from "./model/table.js";
import { followCardString } from "./model/follow.js";
import {
  LANE_GAP,
  LANE_PAD,
  arrangeLane,
  bandIndexAt,
  bandOfRow,
  laneAttrOk,
  laneBands,
  laneFields,
  laneRows,
  serializeBands,
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

  Object.assign(session, {
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
      const board = api.board();
      const rect = api.rects().get(id);
      if (!rect) return Promise.resolve(false);
      const rows = rowsOf(id);
      const bands = laneBands(rows, attr, []);
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
      const existing = rowsOf(id);
      const bands = laneBands([...existing, ...fake], name, lane.laneBands);
      const rect = api.rects().get(id);
      if (!rect) return Promise.resolve(none);
      const size = {
        w: Number(api.setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w,
        h: Number(api.setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h,
      };
      const vertical = lane.axis === "vertical";
      const local = { x: 0, y: 0, w: rect.w, h: rect.h };
      const arranged = arrangeLane({
        w: rect.w,
        h: rect.h,
        axis: lane.axis,
        bands,
        cards: fake.map((row) => ({ uid: row.uid, w: size.w, h: size.h, band: bandOfRow(bands, row, name) })),
      });
      // Below (horizontal lanes) or beside (vertical lanes) what each band already holds.
      const ends = bands.map(() => LANE_PAD);
      for (const row of existing) {
        const r = api.rects().get(row.uid);
        if (!r) continue;
        const at = bandIndexAt(local, lane.axis, bands.length, { x: r.x - rect.x + r.w / 2, y: r.y - rect.y + r.h / 2 });
        ends[at] = Math.max(ends[at], vertical ? r.x - rect.x + r.w + LANE_GAP : r.y - rect.y + r.h + LANE_GAP);
      }
      let needW = Math.max(rect.w, arranged.w);
      let needH = Math.max(rect.h, arranged.h);
      const spots = arranged.cards.map((c) => {
        const at = bandIndexAt({ x: 0, y: 0, w: arranged.w, h: arranged.h }, lane.axis, bands.length, { x: c.x + size.w / 2, y: c.y + size.h / 2 });
        const shift = Math.max(0, ends[at] - LANE_PAD);
        const spot = vertical ? { uid: c.uid, x: c.x + shift, y: c.y } : { uid: c.uid, x: c.x, y: c.y + shift };
        needW = Math.max(needW, spot.x + size.w + LANE_PAD);
        needH = Math.max(needH, spot.y + size.h + LANE_PAD);
        return spot;
      });
      const nextBands = serializeBands(bands);
      return api.txn((t) => {
        const ids = spots.map((spot) => {
          const string = followCardString({ kind: "block", uid: spot.uid });
          const layout = { x: api.round1(spot.x), y: api.round1(spot.y) };
          const look = lookForNewString(string, api.setting("default-card-look", "block"));
          if (look) layout.look = look;
          return t.create({ parent: id, string, plexus: serializeItemLayout(layout) });
        });
        const patch = { w: api.round1(needW), h: api.round1(needH) };
        if (!same(nextBands, lane.laneBands)) patch.bands = nextBands;
        t.props(id, api.itemPlexus(id, patch));
        api.applyFit(t, ids);
        return ids.length;
      }).then((placed) => ({ placed: placed ?? 0, total: all.length }));
    },
  });
});
