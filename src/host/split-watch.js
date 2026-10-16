// Roam re-runs every pull watch after each transaction (100 ms debounce), compares the result with the last one and
// converts the old and the new result of a changed watch to JS. One recursive watch on a big board therefore cost
// ~1.4 s per write anywhere in the graph (PhD main board: 1,559 items over 20k content blocks, 14k of them inside
// nested boards). A big board is watched per container instead: the board, each section and the Connections block,
// each with its direct children only. Card contents come from the open pull, and stay live through one watch per
// mounted card (watchItem); a card that mounts again compares its contents once.
import { classifyString, readPlexus } from "../model/schema.js";

const A = ":block/uid :block/string :block/order :block/heading :block/open :block/props";
export const STRUCT_PATTERN = `[${A} {(limit :block/children nil) [${A}]}]`;
// Connections: the edges, their why notes and the note's children (the why count).
export const EDGES_PATTERN = `[${A} {(limit :block/children nil) [${A} {(limit :block/children nil) [${A} {(limit :block/children nil) [:block/uid]}]}]}]`;
// The Connections watch pattern when the fingerprint is on: uids, order and :edit/time of the edges, of their why
// notes, and the why notes' child uids. Roam stamps :edit/time only on the entity whose string or props changed, so a
// create, move or delete shows up as a changed uid list and a delete's renumbering as a changed :block/order.
// Every children join takes (limit :block/children nil): without it Roam stops at 1,000 values and a short list
// would read as deletions. This pattern is a watch only; reads and assembly stay on EDGES_PATTERN. A change that is
// not order-only reads the Connections block whole, except a time-only stamp whose edge text and props still
// match the stored node: that writes the new fingerprint and returns. The published list always comes from a whole read,
// never from patched pieces, so it can never be shorter than what Roam holds.
export const FINGERPRINT_PATTERN = "[:block/uid {(limit :block/children nil) [:block/uid :block/order :edit/time {(limit :block/children nil) [:block/uid :block/order :edit/time {(limit :block/children nil) [:block/uid]}]}]}]";
// A nested board's thumbnail: its items and their direct children (section members).
export const THUMB_PATTERN = `[${A} {(limit :block/children nil) [${A} {(limit :block/children nil) [${A}]}]}]`;
export const THUMB_DEPTH = 2;
// A card's content watch released by an unmount stays registered this long (at most ITEM_IDLE_MAX of them): a card
// that mounts again (pan, page return, nested re-enter) costs no add/removePullWatch.
export const ITEM_IDLE_MS = 60000;
export const ITEM_IDLE_MAX = 150;
// Boards with at least this many blocks get the split watch.
export const SPLIT_WATCH_MIN = 2000;

const UID = ":block/uid";
const KIDS = ":block/children";
const kidsOf = (node) => (Array.isArray(node?.[KIDS]) ? node[KIDS] : []);
const MARKERS = { edges: "edges", snapshots: "deep", regions: "deep", trails: "deep" };

export function treeSize(node, cap = Infinity) {
  let n = 0;
  const stack = [node];
  while (stack.length && n < cap) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    n += 1;
    for (const kid of kidsOf(cur)) stack.push(kid);
  }
  return n;
}

// "struct": a section (its members are items); "edges" / "deep": a board's own marker block; null: an item.
export function containerKind(node, atRoot) {
  const plexus = readPlexus(node?.[":block/props"]);
  const type = plexus?.type;
  if (atRoot && type && MARKERS[type]) return MARKERS[type];
  if (type === "section") return "struct";
  if (!plexus && (node?.[":block/heading"] || 0) > 0) return "struct";
  return null;
}

const shallow = (node) => {
  const out = {};
  for (const k in node) if (k !== KIDS) out[k] = node[k];
  return out;
};

const propsKey = (p) => (p == null ? "" : JSON.stringify(p));
// Same blocks, text, order and props down to `depth` levels of children.
export function sameKids(a, b, depth = Infinity) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) {
    const p = x[i];
    const q = y[i];
    if (p?.[UID] !== q?.[UID] || (p?.[":block/string"] ?? "") !== (q?.[":block/string"] ?? "")
      || (p?.[":block/order"] ?? null) !== (q?.[":block/order"] ?? null) || (p?.[":block/heading"] || 0) !== (q?.[":block/heading"] || 0)
      || (p?.[":block/open"] ?? null) !== (q?.[":block/open"] ?? null) || propsKey(p?.[":block/props"]) !== propsKey(q?.[":block/props"])) return false;
    if (depth > 1 && !sameKids(kidsOf(p), kidsOf(q), depth - 1)) return false;
  }
  return true;
}

const isBoardItem = (node) => classifyString(String(node?.[":block/string"] ?? "")).kind === "board";

const TIME = ":edit/time";
const ORDER = ":block/order";

// uid -> { order, time, whys: [[uid, time, order, grandchild uids joined]] } for the children of a Connections block.
export function fingerprintOf(node) {
  const out = new Map();
  for (const edge of kidsOf(node)) {
    const id = edge?.[UID];
    if (!id) continue;
    out.set(id, {
      order: edge[ORDER] ?? null,
      time: edge[TIME] ?? null,
      whys: kidsOf(edge).map((why) => [why?.[UID], why?.[TIME] ?? null, why?.[ORDER] ?? null, kidsOf(why).map((g) => g?.[UID]).join(",")]),
    });
  }
  return out;
}

const sameWhys = (a, b) => a.length === b.length && a.every((w, i) => w[0] === b[i][0] && w[1] === b[i][1] && w[2] === b[i][2] && w[3] === b[i][3]);

// What changed between two fingerprints: uids whose body changed or that are new, uids that left, and whether any
// order moved. Stamps compare with !== because undo stamps again.
export function diffFingerprints(prev, next) {
  const changed = [];
  const removed = [];
  let reordered = false;
  for (const [id, now] of next) {
    const was = prev.get(id);
    if (!was) { changed.push(id); continue; }
    if (was.time !== now.time || !sameWhys(was.whys, now.whys)) changed.push(id);
    else if (was.order !== now.order) reordered = true;
  }
  for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  return { changed, removed, reordered };
}

// Uids whose only fingerprint change is :edit/time. Null when the uid set, order, or why-note structure differs.
function timeChangedIds(prev, next) {
  if (!prev || !next || prev.size !== next.size) return null;
  const ids = [];
  for (const [id, now] of next) {
    const was = prev.get(id);
    if (!was) return null;
    if (was.order !== now.order) return null;
    if (!sameWhys(was.whys, now.whys)) return null;
    if (was.time !== now.time) ids.push(id);
  }
  for (const id of prev.keys()) if (!next.has(id)) return null;
  return ids;
}

// The container's own fields and every direct child match, except one child's string.
// That child's uid, or null when the diff is anything else (or nothing).
function soleStringChange(prev, next) {
  if (!prev || !next) return null;
  if ((prev[":block/string"] ?? "") !== (next[":block/string"] ?? "")) return null;
  if ((prev[":block/order"] ?? null) !== (next[":block/order"] ?? null)) return null;
  if ((prev[":block/heading"] || 0) !== (next[":block/heading"] || 0)) return null;
  if ((prev[":block/open"] ?? null) !== (next[":block/open"] ?? null)) return null;
  if (propsKey(prev[":block/props"]) !== propsKey(next[":block/props"])) return null;
  const a = kidsOf(prev);
  const b = kidsOf(next);
  if (a.length !== b.length) return null;
  let hit = null;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (p?.[UID] !== q?.[UID]) return null;
    // Direct fields only. The container pattern does not pull grandchildren, and the stored
    // node still has them, so a body block must not look like a second change.
    const stringChanged = (p?.[":block/string"] ?? "") !== (q?.[":block/string"] ?? "");
    const restChanged = (p?.[":block/order"] ?? null) !== (q?.[":block/order"] ?? null)
      || (p?.[":block/heading"] || 0) !== (q?.[":block/heading"] || 0)
      || (p?.[":block/open"] ?? null) !== (q?.[":block/open"] ?? null)
      || propsKey(p?.[":block/props"]) !== propsKey(q?.[":block/props"]);
    if (!stringChanged && !restChanged) continue;
    if (restChanged || hit) return null;
    hit = q[UID] || null;
  }
  return hit;
}

function childString(node, id) {
  for (const kid of kidsOf(node)) if (kid?.[UID] === id) return kid[":block/string"] ?? "";
  return null;
}

function patchTreeString(tree, id, string) {
  if (!tree) return;
  const stack = [tree];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (cur[UID] === id) {
      cur[":block/string"] = string;
      return;
    }
    for (const kid of kidsOf(cur)) stack.push(kid);
  }
}

export function createSplitWatch({ uid, seed, data, pull, deepPattern, onTree, onEditString = null, editQuiet = () => true, fingerprint = false, guard = (_name, fn) => fn, schedule = (fn) => queueMicrotask(fn) }) {
  const entityOf = (id) => `[:block/uid "${String(id).replace(/["\\]/g, "")}"]`;
  const nodes = new Map();
  const kinds = new Map([[uid, "struct"]]);
  const live = new Map();
  // Connections block uid -> fingerprint of its edges (null: unknown, the next change reads the whole block).
  const fingerprints = new Map();
  let content = new Map();
  // Item contents as last published (or as seeded): the mount-time compare reads against these, so a reseed that
  // replaced `content` with newer contents cannot hide a change the subscribers have not seen.
  let published = new Map();
  const itemWatch = new Map();
  // Released item watches still registered: key -> released at (insertion order is release order).
  const idleItems = new Map();
  let idleTimer = null;
  const dropItem = (key) => {
    const w = itemWatch.get(key);
    idleItems.delete(key);
    if (!w) return;
    itemWatch.delete(key);
    try { data.removePullWatch(w.pattern, w.entity, w.cb); } catch { /* already gone */ }
  };
  const sweepIdle = () => {
    idleTimer = null;
    const cutoff = Date.now() - ITEM_IDLE_MS;
    for (const [key, at] of [...idleItems]) if (at <= cutoff) dropItem(key);
    if (idleItems.size) armSweep();
  };
  const armSweep = () => {
    if (idleTimer != null || disposed) return;
    idleTimer = setTimeout(sweepIdle, ITEM_IDLE_MS);
    try { idleTimer.unref?.(); } catch { /* a fake timer has no unref */ }
  };
  // Cards asked for before a container watch has seen them (the optimistic model mounts a new card before Roam's
  // echo): key -> registrations armed by the next assemble that finds the card.
  const pendingItems = new Map();
  let disposed = false;
  let pending = false;
  let lastTree = null;
  // Held: every subscriber is parked (keep-alive, crumb pool). The watches stay registered, so a park and its return
  // cost no addPullWatch/removePullWatch (each counts toward Roam's 1,500/min limiter, as do openPage and writes).
  // Callbacks only store what Roam sent and mark the tree dirty; release() assembles once if anything changed.
  let held = false;
  let dirty = false;
  let editingUid = null;
  const editQuietOn = () => {
    try {
      const value = typeof editQuiet === "function" ? editQuiet() : editQuiet;
      return value !== false;
    } catch { return true; }
  };

  const patternOf = (kind) => (kind === "edges" ? EDGES_PATTERN : kind === "deep" ? deepPattern : STRUCT_PATTERN);
  const read = (pattern, id) => {
    try { return pull(pattern, entityOf(id)); } catch { return null; }
  };

  // True when a container in the seed differs from the stored one (to its direct children). Contents are not
  // compared here (a walk of every card body on each refreshCardCache pull): a mounting card compares against what
  // was last published instead.
  const seedFrom = (full) => {
    if (!full?.[UID]) return false;
    const depthOf = (kind) => (kind === "edges" ? 3 : kind === "deep" ? Infinity : 2);
    let changed = !sameKids([nodes.get(uid)], [full], 2);
    nodes.set(uid, full);
    const nextContent = new Map();
    const walk = (node, atRoot) => {
      for (const kid of kidsOf(node)) {
        const id = kid?.[UID];
        if (!id) continue;
        const kind = containerKind(kid, atRoot);
        if (kind) {
          if (!changed && !sameKids([nodes.get(id)], [kid], depthOf(kind))) changed = true;
          kinds.set(id, kind);
          nodes.set(id, kid);
          if (kind === "struct") walk(kid, false);
        } else nextContent.set(id, kidsOf(kid));
      }
    };
    walk(full, true);
    for (const [id, kids] of content) if (!nextContent.has(id) && itemWatch.has(id)) nextContent.set(id, kids);
    content = nextContent;
    return changed;
  };

  const kick = () => {
    if (held) { dirty = true; return; }
    if (pending || disposed) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (disposed) return;
      const tree = assemble();
      onTree(tree);
    });
  };

  const onContainer = (id) => guard("watchBoard", (_before, after) => {
    if (disposed) return;
    if (!after?.[UID]) {
      if (id === uid) {
        disposed = true;
        dropAll();
        onTree(null);
        return;
      }
      nodes.delete(id);
      kick();
      return;
    }
    const before = nodes.get(id);
    const sole = before && editingUid ? soleStringChange(before, after) : null;
    nodes.set(id, after);
    if (sole && sole === editingUid && editQuietOn()) {
      const text = childString(after, sole);
      if (text != null) {
        patchTreeString(lastTree, sole, text);
        try { onEditString?.(sole, text); } catch { /* session */ }
        return;
      }
    }
    kick();
  });

  const readWholeEdges = (id) => {
    const fresh = read(EDGES_PATTERN, id);
    return fresh?.[UID] ? fresh : null;
  };

  // The Connections block read whole and the fingerprint of the same moment, back to back in one synchronous turn.
  // Null when either read failed or the block lacks an edge the fingerprint lists (a read caught mid-transaction):
  // nothing is stored and the next change reads again.
  const readConsistent = (id) => {
    const whole = readWholeEdges(id);
    if (!whole) return null;
    const raw = read(FINGERPRINT_PATTERN, id);
    if (!raw?.[UID]) return null;
    const print = fingerprintOf(raw);
    const have = new Set(kidsOf(whole).map((edge) => edge?.[UID]));
    for (const edgeUid of print.keys()) if (!have.has(edgeUid)) return null;
    return { whole, print };
  };

  // True when every time-changed edge's text and props equal the stored node. The fingerprint has no props,
  // so a color edit is a time stamp until this pull. A missing pull_many, a short result, or one different
  // string or props map falls through to the whole read.
  const edgeStringsMatch = (stored, ids) => {
    if (typeof data.pull_many !== "function" || !ids.length) return false;
    let rows = null;
    try {
      rows = data.pull_many("[:block/uid :block/string :block/props]", ids.map((edgeUid) => entityOf(edgeUid)));
    } catch { return false; }
    if (!Array.isArray(rows) || rows.length !== ids.length) return false;
    const have = new Map();
    for (const edge of kidsOf(stored)) {
      if (edge?.[UID]) have.set(edge[UID], { string: edge[":block/string"] ?? "", props: propsKey(edge[":block/props"]) });
    }
    const seen = new Set();
    for (const row of rows) {
      const edgeUid = row?.[UID];
      const got = edgeUid ? have.get(edgeUid) : null;
      if (!got || seen.has(edgeUid)) return false;
      seen.add(edgeUid);
      if ((row[":block/string"] ?? "") !== got.string || propsKey(row[":block/props"]) !== got.props) return false;
    }
    if (seen.size !== ids.length) return false;
    for (const edgeUid of ids) if (!seen.has(edgeUid)) return false;
    return true;
  };

  // The Connections watch: diff the fingerprint. An order-only change re-sorts the stored edges. A time-only
  // stamp whose text and props still match writes the fingerprint and returns. Anything else reads the block whole.
  const onFingerprint = (id) => guard("watchEdges", (_before, after) => {
    if (disposed) return;
    if (held && after?.[UID]) {
      // Read whole on release: the fingerprint diff needs the stored block current.
      nodes.delete(id);
      fingerprints.set(id, null);
      dirty = true;
      return;
    }
    if (!after?.[UID]) {
      nodes.delete(id);
      fingerprints.delete(id);
      kick();
      return;
    }
    const next = fingerprintOf(after);
    const prev = fingerprints.get(id) || null;
    const stored = nodes.get(id);
    let reordered = false;
    if (prev && stored?.[UID]) {
      const diff = diffFingerprints(prev, next);
      const times = !diff.removed.length && !diff.reordered ? timeChangedIds(prev, next) : null;
      if (times && times.length && edgeStringsMatch(stored, times)) {
        fingerprints.set(id, next);
        return;
      }
      if (!diff.changed.length && !diff.removed.length) {
        if (!diff.reordered) return;
        reordered = true;
      }
    }
    if (!reordered) {
      const got = readConsistent(id);
      if (!got) {
        // Keep what is stored and read whole on the next change; never publish a list shorter than Roam's.
        fingerprints.set(id, null);
        return;
      }
      nodes.set(id, got.whole);
      fingerprints.set(id, got.print);
      kick();
      return;
    }
    const kids = kidsOf(stored).map((edge) => {
      const order = next.get(edge[UID])?.order;
      return order != null && edge[ORDER] !== order ? { ...edge, [ORDER]: order } : edge;
    });
    kids.sort((a, b) => (a[ORDER] ?? 0) - (b[ORDER] ?? 0));
    nodes.set(id, { ...shallow(stored), [KIDS]: kids });
    fingerprints.set(id, next);
    kick();
  });

  const sync = () => {
    for (const [id, kind] of kinds) {
      const have = live.get(id);
      if (have && have.kind === kind) continue;
      if (have) data.removePullWatch(have.pattern, have.entity, have.cb);
      const finger = fingerprint && kind === "edges";
      const entry = { kind, pattern: finger ? FINGERPRINT_PATTERN : patternOf(kind), entity: entityOf(id), cb: finger ? onFingerprint(id) : onContainer(id) };
      data.addPullWatch(entry.pattern, entry.entity, entry.cb);
      live.set(id, entry);
      // The stored block came from a seed or an earlier pull, not from a read taken with the fingerprint: the first
      // change reads the block whole.
      if (finger) fingerprints.set(id, null);
    }
    for (const [id, entry] of [...live]) {
      if (kinds.has(id)) continue;
      data.removePullWatch(entry.pattern, entry.entity, entry.cb);
      live.delete(id);
      fingerprints.delete(id);
      nodes.delete(id);
    }
  };

  // The board tree as the open pull would give it: containers from their own watches, items with their stored contents.
  const assemble = () => {
    const root = nodes.get(uid);
    if (!root?.[UID]) return null;
    const seenKinds = new Map([[uid, "struct"]]);
    const seenContent = new Map();
    const build = (node, atRoot) => {
      const out = shallow(node);
      const kids = [];
      for (const kid of kidsOf(node)) {
        const id = kid?.[UID];
        if (!id) continue;
        const kind = containerKind(kid, atRoot);
        if (kind) {
          seenKinds.set(id, kind);
          let own = kinds.get(id) === kind ? nodes.get(id) : null;
          if (!own?.[UID]) {
            own = read(patternOf(kind), id) || kid;
            nodes.set(id, own);
            if (kind === "edges" && fingerprints.has(id)) fingerprints.set(id, null);
          }
          kids.push(kind === "struct" ? build(own, false) : own);
          continue;
        }
        let stored = content.get(id);
        if (stored === undefined) {
          // Whole: a nested board's thumbnail depth is not its subtree (cut and duplicate copy the stored contents).
          const pulled = read(deepPattern, id);
          stored = kidsOf(pulled);
        }
        seenContent.set(id, stored);
        const item = shallow(kid);
        if (stored.length) item[KIDS] = stored;
        kids.push(item);
      }
      if (kids.length) out[KIDS] = kids;
      return out;
    };
    const tree = build(root, true);
    kinds.clear();
    for (const [id, kind] of seenKinds) kinds.set(id, kind);
    for (const [id, kids] of content) if (!seenContent.has(id) && itemWatch.has(id)) seenContent.set(id, kids);
    content = seenContent;
    published = new Map(seenContent);
    sync();
    lastTree = tree;
    armPending();
    return tree;
  };

  const armPending = () => {
    for (const [key, regs] of [...pendingItems]) {
      if (!content.has(key)) continue;
      pendingItems.delete(key);
      for (const reg of regs) if (reg.on) reg.off = watchItem(key);
    }
  };

  const dropAll = () => {
    for (const entry of live.values()) {
      try { data.removePullWatch(entry.pattern, entry.entity, entry.cb); } catch { /* already gone */ }
    }
    live.clear();
    for (const w of itemWatch.values()) {
      try { data.removePullWatch(w.pattern, w.entity, w.cb); } catch { /* already gone */ }
    }
    itemWatch.clear();
    idleItems.clear();
    if (idleTimer != null) { clearTimeout(idleTimer); idleTimer = null; }
    pendingItems.clear();
    // A parked card may still hold an off-closure from this generation; it must not pin the trees.
    nodes.clear();
    kinds.clear();
    fingerprints.clear();
    content = new Map();
    published = new Map();
    lastTree = null;
  };

  // A mounted card keeps its contents live. Null when the item is not on this board; with `pending`, a card the
  // board has not seen yet is armed once it appears.
  const watchItem = (id, { pending = false } = {}) => {
    const key = String(id ?? "");
    if (disposed || !key) return null;
    if (!content.has(key)) {
      if (!pending) return null;
      const reg = { on: true, off: null };
      let regs = pendingItems.get(key);
      if (!regs) { regs = new Set(); pendingItems.set(key, regs); }
      regs.add(reg);
      return () => {
        if (!reg.on) return;
        reg.on = false;
        regs.delete(reg);
        if (!regs.size && pendingItems.get(key) === regs) pendingItems.delete(key);
        reg.off?.();
      };
    }
    let w = itemWatch.get(key);
    if (!w) {
      // A nested board is watched at thumbnail depth (its own session watches the rest), but its stored contents
      // stay the whole subtree: a change seen at that depth reads the subtree again.
      const board = isBoardItem(findItem(key));
      const pattern = board ? THUMB_PATTERN : deepPattern;
      const depth = board ? THUMB_DEPTH : Infinity;
      const whole = (after) => (board ? kidsOf(read(deepPattern, key) || after) : kidsOf(after));
      w = {
        n: 0,
        pattern,
        entity: entityOf(key),
        cb: guard("watchContent", (_before, after) => {
          if (disposed || !after?.[UID] || !itemWatch.has(key)) return;
          if (held) {
            // The release's assemble reads this card whole.
            content.delete(key);
            dirty = true;
            return;
          }
          if (sameKids(content.get(key), kidsOf(after), depth)) return;
          content.set(key, whole(after));
          kick();
        }),
      };
      itemWatch.set(key, w);
      data.addPullWatch(w.pattern, w.entity, w.cb);
      // Contents may have changed while the card was off screen (compared with what subscribers last saw).
      const now = read(pattern, key);
      const seen = published.has(key) ? published.get(key) : content.get(key);
      if (now?.[UID] && !sameKids(seen, kidsOf(now), depth)) {
        content.set(key, whole(now));
        kick();
      }
    }
    w.n += 1;
    idleItems.delete(key);
    let on = true;
    return () => {
      if (!on) return;
      on = false;
      w.n -= 1;
      if (w.n > 0 || itemWatch.get(key) !== w || disposed) return;
      idleItems.set(key, Date.now());
      while (idleItems.size > ITEM_IDLE_MAX) dropItem(idleItems.keys().next().value);
      armSweep();
    };
  };

  seedFrom(seed);
  published = new Map(content);
  try {
    sync();
  } catch (error) {
    // Roam refused one of the adds (rate limit): nothing may stay registered for a split nobody holds.
    disposed = true;
    dropAll();
    throw error;
  }

  return {
    watchItem,
    setEditing(id) {
      editingUid = typeof id === "string" && id ? id : null;
    },
    // Read every container again now (an undo, a refresh) and return the assembled tree; contents stay as stored.
    refresh() {
      if (disposed) return null;
      for (const [id, kind] of kinds) {
        const fresh = read(patternOf(kind), id);
        if (fresh?.[UID]) {
          nodes.set(id, fresh);
          if (kind === "edges" && fingerprints.has(id)) fingerprints.set(id, null);
        } else if (id === uid) return null;
        else nodes.delete(id);
      }
      return assemble();
    },
    // A fresh full pull of the board (catch-up, refresh) replaces what the watches hold.
    // Callers pass a fresh read only (a cached tree can be older than what the watches hold). A seed whose
    // containers differ publishes once (or marks a held split dirty).
    // contents: also compare every item's contents with what was last published (a verifying read of a board that
    // went live from a stored model: a card edited while away must publish). True when it will publish.
    reseed(full, { contents = false } = {}) {
      if (disposed) return false;
      let changed = seedFrom(full);
      if (contents && !changed) {
        for (const [id, kids] of content) {
          if (!published.has(id) || !sameKids(published.get(id), kids)) { changed = true; break; }
        }
      }
      // The seed may be older than what the watch already applied: the next Connections change reads whole.
      for (const id of fingerprints.keys()) fingerprints.set(id, null);
      sync();
      armPending();
      if (changed) kick();
      return changed;
    },
    // The assembled tree without reading the containers again (a split just seeded from a fresh read).
    current() {
      if (disposed) return null;
      return lastTree ?? assemble();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dropAll();
    },
    hold() {
      if (disposed) return;
      held = true;
    },
    // Back from a park: one assemble when a watch fired meanwhile. True when it will publish.
    release() {
      if (disposed || !held) return false;
      held = false;
      if (!dirty) return false;
      dirty = false;
      kick();
      return true;
    },
    get held() { return held; },
    get disposed() { return disposed; },
    stats: () => ({ containers: live.size, items: content.size, itemWatches: itemWatch.size - idleItems.size, idleItemWatches: idleItems.size }),
    get tree() { return lastTree; },
  };

  function findItem(id) {
    for (const node of nodes.values()) {
      for (const kid of kidsOf(node)) if (kid?.[UID] === id) return kid;
    }
    return null;
  }
}
