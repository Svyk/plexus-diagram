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
// A nested board's thumbnail: its items and their direct children (section members).
export const THUMB_PATTERN = `[${A} {(limit :block/children nil) [${A} {(limit :block/children nil) [${A}]}]}]`;
export const THUMB_DEPTH = 2;
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

export function createSplitWatch({ uid, seed, data, pull, deepPattern, onTree, guard = (_name, fn) => fn, schedule = (fn) => queueMicrotask(fn) }) {
  const entityOf = (id) => `[:block/uid "${String(id).replace(/["\\]/g, "")}"]`;
  const nodes = new Map();
  const kinds = new Map([[uid, "struct"]]);
  const live = new Map();
  let content = new Map();
  const itemWatch = new Map();
  // Cards asked for before a container watch has seen them (the optimistic model mounts a new card before Roam's
  // echo): key -> registrations armed by the next assemble that finds the card.
  const pendingItems = new Map();
  let disposed = false;
  let pending = false;
  let lastTree = null;

  const patternOf = (kind) => (kind === "edges" ? EDGES_PATTERN : kind === "deep" ? deepPattern : STRUCT_PATTERN);
  const read = (pattern, id) => {
    try { return pull(pattern, entityOf(id)); } catch { return null; }
  };

  const seedFrom = (full) => {
    if (!full?.[UID]) return;
    nodes.set(uid, full);
    const nextContent = new Map();
    const walk = (node, atRoot) => {
      for (const kid of kidsOf(node)) {
        const id = kid?.[UID];
        if (!id) continue;
        const kind = containerKind(kid, atRoot);
        if (kind) {
          kinds.set(id, kind);
          nodes.set(id, kid);
          if (kind === "struct") walk(kid, false);
        } else nextContent.set(id, kidsOf(kid));
      }
    };
    walk(full, true);
    for (const [id, kids] of content) if (!nextContent.has(id) && itemWatch.has(id)) nextContent.set(id, kids);
    content = nextContent;
  };

  const kick = () => {
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
    } else nodes.set(id, after);
    kick();
  });

  const sync = () => {
    for (const [id, kind] of kinds) {
      const have = live.get(id);
      if (have && have.kind === kind) continue;
      if (have) data.removePullWatch(have.pattern, have.entity, have.cb);
      const entry = { kind, pattern: patternOf(kind), entity: entityOf(id), cb: onContainer(id) };
      data.addPullWatch(entry.pattern, entry.entity, entry.cb);
      live.set(id, entry);
    }
    for (const [id, entry] of [...live]) {
      if (kinds.has(id)) continue;
      data.removePullWatch(entry.pattern, entry.entity, entry.cb);
      live.delete(id);
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
    pendingItems.clear();
    // A parked card may still hold an off-closure from this generation; it must not pin the trees.
    nodes.clear();
    kinds.clear();
    content = new Map();
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
          if (sameKids(content.get(key), kidsOf(after), depth)) return;
          content.set(key, whole(after));
          kick();
        }),
      };
      itemWatch.set(key, w);
      data.addPullWatch(w.pattern, w.entity, w.cb);
      // Contents may have changed while the card was off screen.
      const now = read(pattern, key);
      if (now?.[UID] && !sameKids(content.get(key), kidsOf(now), depth)) {
        content.set(key, whole(now));
        kick();
      }
    }
    w.n += 1;
    let on = true;
    return () => {
      if (!on) return;
      on = false;
      w.n -= 1;
      if (w.n > 0 || itemWatch.get(key) !== w) return;
      itemWatch.delete(key);
      try { data.removePullWatch(w.pattern, w.entity, w.cb); } catch { /* already gone */ }
    };
  };

  seedFrom(seed);
  sync();

  return {
    watchItem,
    // Read every container again now (an undo, a refresh) and return the assembled tree; contents stay as stored.
    refresh() {
      if (disposed) return null;
      for (const [id, kind] of kinds) {
        const fresh = read(patternOf(kind), id);
        if (fresh?.[UID]) nodes.set(id, fresh);
        else if (id === uid) return null;
        else nodes.delete(id);
      }
      return assemble();
    },
    // A fresh full pull of the board (catch-up, refresh) replaces what the watches hold.
    reseed(full) {
      if (disposed) return;
      seedFrom(full);
      sync();
      armPending();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dropAll();
    },
    stats: () => ({ containers: live.size, items: content.size, itemWatches: itemWatch.size }),
    get tree() { return lastTree; },
  };

  function findItem(id) {
    for (const node of nodes.values()) {
      for (const kid of kidsOf(node)) if (kid?.[UID] === id) return kid;
    }
    return null;
  }
}
