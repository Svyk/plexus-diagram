// PXD-9 session calls for a followed source: the pointer in the board's props and the tray's writes. Nothing here
// runs on open or on a timer. The pointer changes only from the Follow menu; cards are written only when the user
// places them (each placed card is a ref card that carries its source key); deleting a followed card records its uid
// so the tray does not offer it again, in the delete's own transaction (one undo). Positions, colors, sections and
// arrows of cards already on the board are never written. PXD-14: a page followed by headings places one section per
// heading (the heading's uid in `head`) with a ref card per block under it.
import { boundsOf, containerAt, toRelative } from "./model/board.js";
import { DEFAULT_SIZES, FIT_PAD, lookForNewString, serializeItemLayout } from "./model/schema.js";
import { FOLLOW_HEAD, headingPlan } from "./model/follow-headings.js";
import {
  BOARD_OWNER_NAME,
  FOLLOW_SRC,
  addSkip,
  followBatches,
  followCardString,
  followColumn,
  followIndex,
  followOwnersOf,
  followPointerFor,
  itemIds,
  keptFollow,
  readFollow,
  sectionGrid,
  sourceKey,
  withFollow,
} from "./model/follow.js";
import { extendSession } from "./session.js";
import { SPREAD_CAP } from "./session-clip.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

extendSession((session, api) => {
  const { host } = api;
  const boardUid = session.uid;

  // The uid a "Don't bring back" stores for a card: what it shows (a page card's page uid).
  const skipIdOf = (item) => {
    const t = item?.target;
    if (t?.kind === "page") {
      if (t.uid) return t.uid;
      try { return host.pageUid?.(t.title) || null; } catch { return null; }
    }
    if (t?.kind === "block" && t.uid) return t.uid;
    return null;
  };

  // PXD-13: an owner is the board or one of its sections; each keeps its pointer in its own block's props.
  const ownerOf = (owner) => (owner === undefined || owner === null || owner === "" ? boardUid : owner);
  const isSection = (owner) => api.board()?.items.get(owner)?.type === "section";
  // The last refused followSource: { reason, by? } (null after one that went through).
  let refusal = null;

  const writePointer = (next, owner = boardUid) => api.txn((t) => {
    const board = api.board();
    if (!board?.enhanced) return false;
    if (owner !== boardUid && !isSection(owner)) return false;
    const base = api.rawPlexus(owner);
    const pointer = next(readFollow(base), base);
    const plexus = withFollow(base, pointer);
    if (same(plexus, base)) return false;
    t.props(owner, plexus);
    return true;
  }).then((ok) => ok === true);

  // entries: source items ({ uid, kind, title? }). Ref cards in a column right of the board's cards, or a column at
  // `at` (a drag). SPREAD_CAP cards per transaction, so each batch is one undo; more go in more batches, one column
  // each. Resolves { placed, batches, total, uids }. A headings source places sections and cards (see placeHeadings);
  // `order` is the source's heading uids in order, from the tray's last read. PXD-13: `owner`, a section that follows
  // a source, places into its own frame (only the board follows headings).
  const placeNow = (entries, { at = null, owner: ownerArg, order = null } = {}) => {
    const none = { placed: 0, batches: 0, total: 0, uids: [] };
    const board = api.board();
    const owner = ownerOf(ownerArg);
    if (owner !== boardUid && !isSection(owner)) return Promise.resolve(none);
    const pointer = owner === boardUid ? readFollow(board?.plexus) : board?.items.get(owner)?.follow || null;
    if (!board || !pointer) return Promise.resolve(none);
    const key = sourceKey(pointer);
    const skipped = new Set(pointer.skip);
    const heads = owner === boardUid && pointer.kind === "headings";
    const { on } = followIndex(board, key);
    const seen = new Set();
    const list = (entries || []).filter((e) => {
      if (typeof e?.uid !== "string" || !e.uid || seen.has(e.uid)) return false;
      // An entry from another source never gets this source's key.
      if (e.src !== undefined && e.src !== key) return false;
      // A heading row is a section, never a card at a drop point.
      if (e.kind === "heading" && (!heads || at)) return false;
      seen.add(e.uid);
      if (heads && e.heading && e.heading !== e.uid && skipped.has(e.heading)) return false;
      return !skipped.has(e.uid) && !itemIds(e).some((id) => on.has(id));
    });
    if (!list.length) return Promise.resolve(none);
    const size = {
      w: Number(api.setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w,
      h: Number(api.setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h,
    };
    if (heads && !at) return placeHeadings(list, size, key, order);
    const rects = api.rects();
    const bounds = boundsOf(board.roots.map((id) => rects.get(id)).filter(Boolean));
    // A section's own Place / Place all: a grid inside its frame, below its cards, as its children (a drag still lands
    // where it is dropped).
    const inSection = owner !== boardUid && !at;
    const grid = inSection
      ? sectionGrid(rects.get(owner), board.items.get(owner).members.map((id) => rects.get(id)).filter(Boolean), list.length, { ...size, pad: FIT_PAD })
      : null;
    const batches = followBatches(list, SPREAD_CAP);
    const made = [];
    let chain = Promise.resolve();
    batches.forEach((batch, column) => {
      chain = chain.then(() => {
        if (api.isGone()) return null;
        if (inSection && !api.board()?.items.has(owner)) return null;
        const spots = inSection ? grid.slice(column * SPREAD_CAP, column * SPREAD_CAP + batch.length) : followColumn(bounds, batch.length, { ...size, column, at });
        return api.txn((t) => {
          const ids = batch.map((entry, i) => placeOne(t, followCardString(entry), spots[i], size, key, heads && typeof entry.heading === "string" ? entry.heading : "", inSection ? owner : null));
          api.applyFit(t, ids);
          return ids;
        }).then((ids) => { if (Array.isArray(ids)) made.push(...ids); });
      });
    });
    return chain.then(() => ({ placed: made.length, batches: batches.length, total: list.length, uids: made }));
  };
  let placing = Promise.resolve(null);

  // PXD-14: sections and the cards under them, from headingPlan. At most SPREAD_CAP ops (sections and cards) per
  // transaction, so each batch is one undo; a card whose section was made in an earlier batch is parented to it.
  // Resolves { placed (cards), sections, batches, total, uids (cards and new sections) }.
  function placeHeadings(list, size, key, order) {
    const board = api.board();
    const heads = Array.isArray(order) ? order : [...new Set(list.map((e) => e.heading).filter(Boolean))];
    const ops = headingPlan({ entries: list, order: heads, board, rects: api.rects(), key, size });
    const batches = followBatches(ops, SPREAD_CAP);
    // A card with no stored size is drawn at DEFAULT_SIZES.card, so any other default size is written on each card.
    const sized = size.w !== DEFAULT_SIZES.card.w || size.h !== DEFAULT_SIZES.card.h ? size : {};
    const made = [];
    const sectionAt = new Map();
    let cards = 0;
    let sections = 0;
    let failed = false;
    let chain = Promise.resolve();
    for (const batch of batches) {
      chain = chain.then(() => {
        if (failed || api.isGone()) return null;
        return api.txn((t) => {
          const now = api.board();
          const rects = api.rects();
          const ids = [];
          const fresh = [];
          let n = 0;
          for (const op of batch) {
            if (op.op === "section") {
              const layout = { type: "section", x: op.x, y: op.y, w: op.w, h: op.h };
              const uid = t.create({ parent: boardUid, string: op.title, plexus: { ...serializeItemLayout(layout), [FOLLOW_SRC]: key, [FOLLOW_HEAD]: op.head } });
              sectionAt.set(op.head, { uid, x: api.round1(op.x), y: api.round1(op.y) });
              ids.push(uid);
              fresh.push(uid);
              continue;
            }
            const home = op.into ? { uid: op.into } : sectionAt.get(op.head);
            if (!home) continue;
            const rel = op.into ? toRelative(now, op.into, op, rects) : { x: op.x - home.x, y: op.y - home.y };
            const string = followCardString(op);
            const layout = { x: api.round1(rel.x), y: api.round1(rel.y), ...sized };
            const look = lookForNewString(string, api.setting("default-card-look", "block"));
            if (look) layout.look = look;
            ids.push(t.create({ parent: home.uid, string, plexus: { ...serializeItemLayout(layout), [FOLLOW_SRC]: key, [FOLLOW_HEAD]: op.head } }));
            n += 1;
          }
          api.applyFit(t, ids);
          return { ids, cards: n, sections: fresh.length };
        }).then((res) => {
          if (!res) { failed = true; return; }
          made.push(...res.ids);
          cards += res.cards;
          sections += res.sections;
        });
      });
    }
    return chain.then(() => ({ placed: cards, sections, batches: batches.length, total: list.length, uids: made }));
  }

  // Deleting a followed card of the current source (or any card with followSkip) keeps it out of the tray.
  // PXD-13: the skip goes to the owner whose source key the card carries (a section's card to that section). A card
  // without a source's key goes to the board's list on Remove, don't bring back. An owner deleted in the same call
  // takes its pointer with it.
  api.onDeleteItems?.((t, uids, opts) => {
    const board = api.board();
    if (!board) return;
    const gone = new Set(uids);
    const byKey = new Map();
    for (const o of followOwnersOf(board).owners) if (!byKey.has(o.key)) byKey.set(o.key, o.uid);
    const boardKey = sourceKey(readFollow(api.rawPlexus(boardUid)));
    const adds = new Map();
    const add = (owner, uid) => {
      if (!adds.has(owner)) adds.set(owner, []);
      adds.get(owner).push(uid);
    };
    // PXD-14: a deleted heading section keeps its heading, and so every block under it, out of the tray; those blocks'
    // own uids are not listed as well. Only the board follows headings.
    const heads = new Set();
    for (const id of uids) {
      const item = board.items.get(id);
      if (boardKey && item?.type === "section" && item.head && (item.src === boardKey || opts?.followSkip === true)) heads.add(item.head);
    }
    for (const head of heads) add(boardUid, head);
    for (const id of uids) {
      const item = board.items.get(id);
      if (!item) continue;
      const owner = byKey.get(item.src) ?? (opts?.followSkip === true && boardKey ? boardUid : null);
      if (!owner || gone.has(owner)) continue;
      if (owner === boardUid && (item.type === "section" ? item.head : heads.has(item.head))) continue;
      const skip = skipIdOf(item);
      if (skip) add(owner, skip);
    }
    for (const [owner, list] of adds) {
      const base = api.rawPlexus(owner);
      const pointer = readFollow(base);
      if (pointer) t.props(owner, withFollow(base, { ...pointer, skip: addSkip(pointer.skip, list) }));
    }
  });

  // One ref card. The parent is the section under its center, as for any drop, or `into` (a section's own Place).
  function placeOne(t, string, spot, size, key, head = "", into = null) {
    const board = api.board();
    const rects = api.rects();
    const parent = into || containerAt(board, { x: spot.x + size.w / 2, y: spot.y + size.h / 2 }, { rects });
    const rel = toRelative(board, parent, spot, rects);
    const layout = { x: api.round1(rel.x), y: api.round1(rel.y) };
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: { ...serializeItemLayout(layout), [FOLLOW_SRC]: key, ...(head ? { [FOLLOW_HEAD]: head } : {}) } });
  }

  Object.assign(session, {
    followState() {
      const pointer = readFollow(api.board()?.plexus);
      return pointer ? { pointer, key: sourceKey(pointer), followDerived: api.board()?.followDerived === true } : null;
    },

    // PXD-13: every owner that follows a source, sections in outline order then the board ({ owners, capped }).
    followOwners() {
      return followOwnersOf(api.board());
    },

    // Why the last followSource was refused: { reason: "invalid" | "not-section" | "self" | "taken" | "cap" | "kind" |
    // "unchanged", by? (the owner that follows it) }, or null.
    followRefusal() {
      return refusal;
    },

    // Every block of the board's own tree: never a query or linked-reference result.
    followExclude() {
      const out = new Set(api.ix().keys());
      out.add(boardUid);
      return out;
    },

    // { kind, uid, tree, owner }. The same source keeps its skip list. Resolves true when the pointer changed; on false
    // followRefusal() says why. A source key is followed by one owner per board, at most FOLLOW_SECTION_CAP sections
    // follow one, and a section cannot follow its own block or the board.
    followSource({ kind, uid, tree, owner: ownerArg } = {}) {
      const owner = ownerOf(ownerArg);
      const refuse = (reason, by) => { refusal = by ? { reason, by } : { reason }; return Promise.resolve(false); };
      refusal = null;
      if (typeof kind !== "string" || typeof uid !== "string" || !uid) return refuse("invalid");
      if (owner !== boardUid && !isSection(owner)) return refuse("not-section");
      if (uid === boardUid || uid === owner) return refuse("self");
      // A headings source makes sections of its own: only the board follows one.
      if (kind === "headings" && owner !== boardUid) return refuse("kind");
      const key = `${kind}:${uid}`;
      const { owners, capped } = followOwnersOf(api.board());
      const other = owners.find((o) => o.key === key && o.uid !== owner);
      if (other) return refuse("taken", other.name === BOARD_OWNER_NAME ? "the board" : other.name);
      if (owner !== boardUid && capped && !owners.some((o) => o.uid === owner)) return refuse("cap");
      // The kept skip list of this source, when the owner stopped following it before.
      return writePointer((cur, base) => followPointerFor(keptFollow(base, key) || cur, kind, uid, { tree }), owner)
        .then((ok) => { if (!ok) refusal = { reason: "unchanged" }; return ok; });
    },

    setFollowTree(on, owner) {
      return writePointer((cur) => (cur?.kind === "block" ? { ...cur, tree: on === true } : cur), ownerOf(owner));
    },

    // The cards stay; only the pointer (and its skip list) goes.
    stopFollowing(owner) {
      return writePointer(() => null, ownerOf(owner));
    },

    // Calls run one after another, and each filters against the board the previous one left, so a second Place all
    // (or a drag) while the first is still writing never places a card twice. A skipped uid is never placed.
    // opts: { at, owner }.
    placeFollowed(entries, opts = {}) {
      const run = () => placeNow(entries, opts);
      placing = placing.then(run, run);
      return placing;
    },

    // Source uids the tray should stop offering, on the owner's list. Resolves the number added.
    dontBringBack(uids, ownerArg) {
      const owner = ownerOf(ownerArg);
      return api.txn((t) => {
        if (owner !== boardUid && !isSection(owner)) return 0;
        const base = api.rawPlexus(owner);
        const pointer = readFollow(base);
        if (!pointer) return 0;
        const skip = addSkip(pointer.skip, uids);
        if (same(skip, pointer.skip)) return 0;
        t.props(owner, withFollow(base, { ...pointer, skip }));
        return skip.length - pointer.skip.length;
      }).then((n) => n ?? 0);
    },

    // Cards off the board, and their source uids on the skip list, in one transaction.
    removeFollowed(cardUids) {
      return session.deleteItems(cardUids, { followSkip: true });
    },

    // Drops the source mark from cards (a "left the source" card becomes a plain card; a section also lets go of its
    // heading). Everything else stays.
    dismissLeft(cardUids) {
      return api.txn((t) => {
        let n = 0;
        for (const id of cardUids || []) {
          const raw = api.rawPlexus(id);
          if (!api.board()?.items.has(id) || !(FOLLOW_SRC in raw)) continue;
          const next = { ...raw };
          delete next[FOLLOW_SRC];
          delete next[FOLLOW_HEAD];
          t.props(id, next);
          n += 1;
        }
        return n;
      }).then((n) => n ?? 0);
    },

    // PXD-14: `{ cardUid: headingUid }`. The card stays where it is and takes the heading its block moved to as its
    // own, so the tray stops calling it moved. Resolves the number written.
    dismissMoved(moved) {
      const pairs = moved instanceof Map ? [...moved] : Object.entries(moved || {});
      return api.txn((t) => {
        let n = 0;
        for (const [id, to] of pairs) {
          const item = api.board()?.items.get(id);
          if (!item || typeof item.head !== "string" || typeof to !== "string" || !to || item.head === to) continue;
          t.props(id, { ...api.rawPlexus(id), [FOLLOW_HEAD]: to });
          n += 1;
        }
        return n;
      }).then((n) => n ?? 0);
    },
  });
});
