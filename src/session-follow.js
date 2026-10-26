// PXD-9 session calls for a followed source: the pointer in the board's props and the tray's writes. Nothing here
// runs on open or on a timer. The pointer changes only from the Follow menu; cards are written only when the user
// places them (each placed card is a ref card that carries its source key); deleting a followed card records its uid
// so the tray does not offer it again, in the delete's own transaction (one undo). Positions, colors, sections and
// arrows of cards already on the board are never written.
import { boundsOf, containerAt, toRelative } from "./model/board.js";
import { DEFAULT_SIZES, lookForNewString, serializeItemLayout } from "./model/schema.js";
import {
  FOLLOW_SRC,
  addSkip,
  followBatches,
  followCardString,
  followColumn,
  followIndex,
  followPointerFor,
  itemIds,
  readFollow,
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

  const writePointer = (next) => api.txn((t) => {
    const board = api.board();
    if (!board?.enhanced) return false;
    const base = api.rawPlexus(boardUid);
    const pointer = next(readFollow(base));
    const plexus = withFollow(base, pointer);
    if (same(plexus, base)) return false;
    t.props(boardUid, plexus);
    return true;
  }).then((ok) => ok === true);

  // entries: source items ({ uid, kind, title? }). Ref cards in a column right of the board's cards, or a column at
  // `at` (a drag). SPREAD_CAP cards per transaction, so each batch is one undo; more go in more batches, one column
  // each. Resolves { placed, batches, total, uids }.
  const placeNow = (entries, { at = null } = {}) => {
    const none = { placed: 0, batches: 0, total: 0, uids: [] };
    const board = api.board();
    const pointer = readFollow(board?.plexus);
    if (!board || !pointer) return Promise.resolve(none);
    const key = sourceKey(pointer);
    const skipped = new Set(pointer.skip);
    const { on } = followIndex(board, key);
    const seen = new Set();
    const list = (entries || []).filter((e) => {
      if (typeof e?.uid !== "string" || !e.uid || seen.has(e.uid)) return false;
      seen.add(e.uid);
      return !skipped.has(e.uid) && !itemIds(e).some((id) => on.has(id));
    });
    if (!list.length) return Promise.resolve(none);
    const size = {
      w: Number(api.setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w,
      h: Number(api.setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h,
    };
    const rects = api.rects();
    const bounds = boundsOf(board.roots.map((id) => rects.get(id)).filter(Boolean));
    const batches = followBatches(list, SPREAD_CAP);
    const made = [];
    let chain = Promise.resolve();
    batches.forEach((batch, column) => {
      chain = chain.then(() => {
        if (api.isGone()) return null;
        const spots = followColumn(bounds, batch.length, { ...size, column, at });
        return api.txn((t) => {
          const ids = batch.map((entry, i) => placeOne(t, followCardString(entry), spots[i], size, key));
          api.applyFit(t, ids);
          return ids;
        }).then((ids) => { if (Array.isArray(ids)) made.push(...ids); });
      });
    });
    return chain.then(() => ({ placed: made.length, batches: batches.length, total: list.length, uids: made }));
  };
  let placing = Promise.resolve(null);

  // Deleting a followed card of the current source (or any card with followSkip) keeps it out of the tray.
  api.onDeleteItems?.((t, uids, opts) => {
    const board = api.board();
    const base = api.rawPlexus(boardUid);
    const pointer = readFollow(base);
    if (!board || !pointer) return;
    const key = sourceKey(pointer);
    const add = [];
    for (const id of uids) {
      const item = board.items.get(id);
      if (!item || (item.src !== key && opts?.followSkip !== true)) continue;
      const skip = skipIdOf(item);
      if (skip) add.push(skip);
    }
    if (add.length) t.props(boardUid, withFollow(base, { ...pointer, skip: addSkip(pointer.skip, add) }));
  });

  // One ref card. The parent is the section under its center, as for any drop.
  function placeOne(t, string, spot, size, key) {
    const board = api.board();
    const rects = api.rects();
    const parent = containerAt(board, { x: spot.x + size.w / 2, y: spot.y + size.h / 2 }, { rects });
    const rel = toRelative(board, parent, spot, rects);
    const layout = { x: api.round1(rel.x), y: api.round1(rel.y) };
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: { ...serializeItemLayout(layout), [FOLLOW_SRC]: key } });
  }

  Object.assign(session, {
    followState() {
      const pointer = readFollow(api.board()?.plexus);
      return pointer ? { pointer, key: sourceKey(pointer) } : null;
    },

    // Every block of the board's own tree: never a query or linked-reference result.
    followExclude() {
      const out = new Set(api.ix().keys());
      out.add(boardUid);
      return out;
    },

    // { kind, uid, tree }. The same source keeps its skip list. Resolves true when the pointer changed.
    followSource({ kind, uid, tree } = {}) {
      if (typeof kind !== "string" || typeof uid !== "string" || !uid || uid === boardUid) return Promise.resolve(false);
      return writePointer((cur) => followPointerFor(cur, kind, uid, { tree }));
    },

    setFollowTree(on) {
      return writePointer((cur) => (cur?.kind === "block" ? { ...cur, tree: on === true } : cur));
    },

    // The cards stay; only the pointer (and its skip list) goes.
    stopFollowing() {
      return writePointer(() => null);
    },

    // Calls run one after another, and each filters against the board the previous one left, so a second Place all
    // (or a drag) while the first is still writing never places a card twice. A skipped uid is never placed.
    placeFollowed(entries, opts = {}) {
      const run = () => placeNow(entries, opts);
      placing = placing.then(run, run);
      return placing;
    },

    // Source uids the tray should stop offering. Resolves the number added.
    dontBringBack(uids) {
      return api.txn((t) => {
        const base = api.rawPlexus(boardUid);
        const pointer = readFollow(base);
        if (!pointer) return 0;
        const skip = addSkip(pointer.skip, uids);
        if (same(skip, pointer.skip)) return 0;
        t.props(boardUid, withFollow(base, { ...pointer, skip }));
        return skip.length - pointer.skip.length;
      }).then((n) => n ?? 0);
    },

    // Cards off the board, and their source uids on the skip list, in one transaction.
    removeFollowed(cardUids) {
      return session.deleteItems(cardUids, { followSkip: true });
    },

    // Drops the source mark from cards (a "left the source" card becomes a plain card). Everything else stays.
    dismissLeft(cardUids) {
      return api.txn((t) => {
        let n = 0;
        for (const id of cardUids || []) {
          const raw = api.rawPlexus(id);
          if (!api.board()?.items.has(id) || !(FOLLOW_SRC in raw)) continue;
          const next = { ...raw };
          delete next[FOLLOW_SRC];
          t.props(id, next);
          n += 1;
        }
        return n;
      }).then((n) => n ?? 0);
    },
  });
});
