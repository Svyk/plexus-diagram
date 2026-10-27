// PXD-9 session calls for a followed source: the pointer in the board's props and the tray's writes. Nothing here
// runs on open or on a timer. The pointer changes only from the Follow menu; cards are written only when the user
// places them (each placed card is a ref card that carries its source key); deleting a followed card records its uid
// so the tray does not offer it again, in the delete's own transaction (one undo). Positions, colors, sections and
// arrows of cards already on the board are never written.
import { boundsOf, containerAt, toRelative } from "./model/board.js";
import { DEFAULT_SIZES, FIT_PAD, lookForNewString, serializeItemLayout } from "./model/schema.js";
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
  // each. Resolves { placed, batches, total, uids }.
  const placeNow = (entries, { at = null, owner: ownerArg } = {}) => {
    const none = { placed: 0, batches: 0, total: 0, uids: [] };
    const board = api.board();
    const owner = ownerOf(ownerArg);
    if (owner !== boardUid && !isSection(owner)) return Promise.resolve(none);
    const pointer = owner === boardUid ? readFollow(board?.plexus) : board?.items.get(owner)?.follow || null;
    if (!board || !pointer) return Promise.resolve(none);
    const key = sourceKey(pointer);
    const skipped = new Set(pointer.skip);
    const { on } = followIndex(board, key);
    const seen = new Set();
    const list = (entries || []).filter((e) => {
      if (typeof e?.uid !== "string" || !e.uid || seen.has(e.uid)) return false;
      // An entry from another source never gets this source's key.
      if (e.src !== undefined && e.src !== key) return false;
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
          const ids = batch.map((entry, i) => placeOne(t, followCardString(entry), spots[i], size, key, inSection ? owner : null));
          api.applyFit(t, ids);
          return ids;
        }).then((ids) => { if (Array.isArray(ids)) made.push(...ids); });
      });
    });
    return chain.then(() => ({ placed: made.length, batches: batches.length, total: list.length, uids: made }));
  };
  let placing = Promise.resolve(null);

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
    const adds = new Map();
    for (const id of uids) {
      const item = board.items.get(id);
      if (!item) continue;
      const owner = byKey.get(item.src) ?? (opts?.followSkip === true && readFollow(api.rawPlexus(boardUid)) ? boardUid : null);
      if (!owner || gone.has(owner)) continue;
      const skip = skipIdOf(item);
      if (!skip) continue;
      if (!adds.has(owner)) adds.set(owner, []);
      adds.get(owner).push(skip);
    }
    for (const [owner, add] of adds) {
      const base = api.rawPlexus(owner);
      const pointer = readFollow(base);
      if (pointer) t.props(owner, withFollow(base, { ...pointer, skip: addSkip(pointer.skip, add) }));
    }
  });

  // One ref card. The parent is the section under its center, as for any drop, or `into` (a section's own Place).
  function placeOne(t, string, spot, size, key, into = null) {
    const board = api.board();
    const rects = api.rects();
    const parent = into || containerAt(board, { x: spot.x + size.w / 2, y: spot.y + size.h / 2 }, { rects });
    const rel = toRelative(board, parent, spot, rects);
    const layout = { x: api.round1(rel.x), y: api.round1(rel.y) };
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: { ...serializeItemLayout(layout), [FOLLOW_SRC]: key } });
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

    // Why the last followSource was refused: { reason: "invalid" | "not-section" | "self" | "taken" | "cap" |
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
