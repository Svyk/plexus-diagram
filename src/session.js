import {
  boundsOf,
  buildBoard,
  containerAt,
  diffBoards,
  edgesTouching,
  findEdge,
  itemsInRect,
  membershipPlan,
  sectionAdoptPlan,
  toRelative,
  topLevelOf,
  worldRects,
} from "./model/board.js";
import {
  DEFAULT_SIZES,
  MIN_SIZES,
  attrNameOf,
  edgeString,
  mergePropsForWrite,
  normalizeEdge,
  plainKeys,
  readPlexus,
  semanticRef,
  serializeEdge,
  serializeItemLayout,
} from "./model/schema.js";
import { coveredBy, filterLinks, linksQuery, reduceLinks } from "./model/links.js";
import { createEchoLedger, createWriteQueue } from "./host/roam.js";
import { executeImport, planImport, readNative, readV06Entry } from "./host/migrate.js";

const UID = ":block/uid";
const STR = ":block/string";
const ORD = ":block/order";
const KIDS = ":block/children";
const PROPS = ":block/props";
const OPEN = ":block/open";

const LINK_MODES = ["off", "attributes", "all"];
const ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize"];
const EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color"];
const MAX_PARENT_STRINGS = 200;

const registry = new Map();

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const round1 = (n) => Math.round(n * 10) / 10;

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
const stable = (v) => (v == null ? "null" : JSON.stringify(sortKeys(v)));

function kidsOf(node) {
  const kids = Array.isArray(node?.[KIDS]) ? node[KIDS] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[ORD] ?? a.i) - (b.c[ORD] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function indexTree(root) {
  const map = new Map();
  const walk = (node, parent) => {
    map.set(node[UID], { node, parent });
    for (const c of node[KIDS] ?? []) walk(c, node);
  };
  if (root) walk(root, null);
  return map;
}

function detach(idx, uid) {
  const hit = idx.get(uid);
  if (!hit?.parent) return null;
  const kids = hit.parent[KIDS] ?? [];
  const at = kids.indexOf(hit.node);
  if (at >= 0) kids.splice(at, 1);
  return hit;
}

function attach(parentNode, node, order) {
  const kids = kidsOf(parentNode);
  if (order === "last" || typeof order !== "number") kids.push(node);
  else kids.splice(Math.max(0, Math.min(order, kids.length)), 0, node);
  kids.forEach((k, i) => { k[ORD] = i; });
  parentNode[KIDS] = kids;
}

function unknownKeys(plexus, known) {
  const out = {};
  for (const [k, v] of Object.entries(plexus ?? {})) if (!known.includes(k)) out[k] = v;
  return out;
}

function createSession(uid, { host, settings = null, raf, now = Date.now, idle, linkDelay = 1500, graceMs = 800 } = {}) {
  const schedule = raf ?? ((fn) => {
    if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(fn);
    const t = setTimeout(fn, 0);
    t.unref?.();
    return t;
  });
  const runIdle = idle ?? ((fn) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(fn, { timeout: 2000 });
    else fn();
  });

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of [...(listeners.get(name) ?? [])]) {
      try { fn(payload); } catch (err) { console.error("[plexus session]", err); }
    }
  };

  let busy = false;
  const queue = createWriteQueue({ onBusy: (b) => { busy = b; emit("busy", b); } });
  const ledger = createEchoLedger({ graceMs, now });

  let destroyed = false;
  let raw = clone(host.pullBoard(uid));
  let board = null;
  let rects = new Map();
  let emitted = null;
  let rix = null;

  const ix = () => (rix ??= indexTree(raw));
  const rebuild = () => {
    rix = null;
    board = raw ? buildBoard(raw) : null;
    rects = board ? worldRects(board) : new Map();
  };
  rebuild();
  emitted = board;

  let allLinks = [];
  let visibleLinks = [];
  let covered = new Set();
  let linkFingerprint = "";
  const initialMode = settings?.get?.("linkMode");
  let linkMode = LINK_MODES.includes(initialMode) ? initialMode : "attributes";

  // ---- raw tree helpers (optimistic model) ----
  const rawNode = (id) => (id === uid ? raw : ix().get(id)?.node ?? null);
  const insertOrder = (parentUid) => {
    if (parentUid !== uid || !raw) return "last";
    const kids = kidsOf(raw);
    const at = kids.findIndex((k) => readPlexus(k[PROPS])?.type === "edges");
    return at >= 0 ? at : "last";
  };
  const rawInsert = (parentUid, node, order) => {
    const parent = rawNode(parentUid);
    if (!parent) return;
    attach(parent, node, order);
    rix = null;
  };
  const rawMove = (id, parentUid, order) => {
    const hit = ix().get(id);
    if (!hit?.parent) return;
    detach(ix(), id);
    rix = null;
    const parent = rawNode(parentUid);
    if (parent) attach(parent, hit.node, order);
    rix = null;
  };
  const rawDelete = (id) => { detach(ix(), id); rix = null; };
  const rawProps = (id, plexus) => {
    const node = rawNode(id);
    if (node) node[PROPS] = mergePropsForWrite(node[PROPS], plexus);
  };
  const rawString = (id, string) => {
    const node = rawNode(id);
    if (node) node[STR] = string;
  };

  const publish = () => {
    rebuild();
    if (!board) return;
    const diff = diffBoards(emitted, board);
    emitted = board;
    if (diff.structural || diff.dirty.size) emit("change", diff);
    recomputeLinks(false);
    if (diff.structural) refreshLinks();
  };

  const repull = () => {
    if (destroyed) return;
    const fresh = host.pullBoard(uid);
    if (!fresh) return;
    raw = clone(fresh);
    publish();
  };

  // ---- echo rebase ----
  function rebase(incoming) {
    const tracked = ledger.tracked();
    if (!tracked.length) return incoming;
    const ours = ix();
    const inc = indexTree(incoming);
    const incUid = incoming[UID];
    for (const [id, field] of tracked) {
      if (field === "parent") {
        const mine = ours.get(id);
        const theirs = inc.get(id);
        const myParent = mine?.parent?.[UID] ?? "";
        const theirParent = theirs?.parent?.[UID] ?? "";
        if (ledger.accept(id, "parent", theirParent)) continue;
        if (myParent === theirParent) continue;
        if (!mine) {
          detach(inc, id);
          inc.delete(id);
        } else if (!theirs) {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          const node = { ...mine.node, [KIDS]: [] };
          target[KIDS] = [...(target[KIDS] ?? []), node];
          inc.set(id, { node, parent: target });
        } else {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          detach(inc, id);
          theirs.node[ORD] = mine.node[ORD];
          target[KIDS] = [...(target[KIDS] ?? []), theirs.node];
          inc.set(id, { node: theirs.node, parent: target });
        }
      } else if (field === "props") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        const theirPlexus = readPlexus(theirs.node[PROPS]);
        if (ledger.accept(id, "props", stable(theirPlexus))) continue;
        if (!mine) continue;
        const myPlexus = readPlexus(mine.node[PROPS]);
        theirs.node[PROPS] = mergePropsForWrite(theirs.node[PROPS], myPlexus);
      } else if (field === "string") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        if (ledger.accept(id, "string", theirs.node[STR] ?? "")) continue;
        if (mine) theirs.node[STR] = mine.node[STR] ?? "";
      }
    }
    return incoming;
  }

  // ---- watch ----
  let latest = null;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (destroyed || !latest) return;
    const incoming = clone(latest);
    latest = null;
    raw = rebase(incoming);
    publish();
  };
  const unwatch = raw
    ? host.watchBoard(uid, (after) => {
      if (destroyed || !after || !after[UID]) return;
      latest = after;
      if (!scheduled) { scheduled = true; schedule(flush); }
    })
    : () => {};

  // ---- write pipeline ----
  const fieldsOf = (op) => {
    if (op.op === "create") {
      const out = [["parent", op.parent]];
      if (op.props?.plexus !== undefined) out.push(["props", stable(op.props.plexus)]);
      return out;
    }
    if (op.op === "move") return [["parent", op.parent]];
    if (op.op === "delete") return [["parent", ""]];
    if (op.op === "props") return [["props", stable(op.plexus)]];
    if (op.op === "string") return [["string", op.string]];
    return [];
  };
  const settleOp = (op) => { for (const [f] of fieldsOf(op)) ledger.settle(op.uid, f); };

  async function runOp(op) {
    switch (op.op) {
      case "create":
        await host.createBlock({ parentUid: op.parent, order: op.order, uid: op.uid, string: op.string, props: op.props, open: op.open });
        break;
      case "move": await host.moveBlock(op.uid, op.parent, op.order); break;
      case "delete": await host.deleteBlock(op.uid); break;
      case "props": await host.updateProps(op.uid, op.plexus); break;
      case "string": await host.updateString(op.uid, op.string); break;
      default: break;
    }
  }

  async function execute(list) {
    let i = 0;
    try {
      for (; i < list.length; i++) {
        await runOp(list[i]);
        settleOp(list[i]);
      }
    } catch (err) {
      for (let j = i; j < list.length; j++) settleOp(list[j]);
      throw err;
    }
  }

  function coalesce(ops) {
    const out = [];
    const creates = new Map();
    const props = new Map();
    const strings = new Map();
    for (const op of ops) {
      if (op.op === "create") { out.push(op); creates.set(op.uid, op); continue; }
      if (op.op === "props") {
        const c = creates.get(op.uid);
        if (c) { c.props = mergePropsForWrite(c.props, op.plexus); continue; }
        const prev = props.get(op.uid);
        if (prev) { prev.plexus = op.plexus; continue; }
        const next = { ...op };
        props.set(op.uid, next);
        out.push(next);
        continue;
      }
      if (op.op === "string") {
        const c = creates.get(op.uid);
        if (c) { c.string = op.string; continue; }
        const prev = strings.get(op.uid);
        if (prev) { prev.string = op.string; continue; }
        const next = { ...op };
        strings.set(op.uid, next);
        out.push(next);
        continue;
      }
      out.push(op);
    }
    return out;
  }

  function handleFailure(err) {
    console.error("[plexus session] write failed", err);
    ledger.clear();
    emit("toast", { message: "Couldn't save changes to Roam. Reloaded the board from the graph." });
    repull();
  }

  function commit(ops, result) {
    if (!ops.length) return Promise.resolve(result);
    const list = coalesce(ops);
    for (const op of list) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    return queue.run(() => execute(list)).then(() => result, (err) => { handleFailure(err); return result; });
  }

  function txn(fn) {
    if (!board || destroyed) return Promise.resolve(undefined);
    const ops = [];
    const t = {
      create({ parent, uid: id, string = "", plexus, open, order }) {
        const newUid = id ?? host.generateUid();
        const ord = order ?? insertOrder(parent);
        const node = { [UID]: newUid, [STR]: string, [ORD]: 0, [KIDS]: [] };
        if (plexus) node[PROPS] = { plexus: plainKeys(plexus) };
        if (open !== undefined) node[OPEN] = open;
        rawInsert(parent, node, ord);
        ops.push({ op: "create", uid: newUid, parent, order: ord, string, props: plexus ? { plexus } : undefined, open });
        return newUid;
      },
      move(id, parent, order = "last") {
        rawMove(id, parent, order);
        ops.push({ op: "move", uid: id, parent, order });
      },
      del(id) {
        rawDelete(id);
        ops.push({ op: "delete", uid: id });
      },
      props(id, plexus) {
        rawProps(id, plexus);
        ops.push({ op: "props", uid: id, plexus });
      },
      string(id, string) {
        rawString(id, string);
        ops.push({ op: "string", uid: id, string });
      },
      sync: rebuild,
    };
    const result = fn(t);
    return commit(ops, result);
  }

  // ---- layout helpers ----
  const rawPlexus = (id) => readPlexus(rawNode(id)?.[PROPS]) ?? {};

  function itemPlexus(id, patch) {
    const item = board.items.get(id);
    const base = rawPlexus(id);
    const merged = { ...base, type: item?.type ?? base.type, ...patch };
    const known = serializeItemLayout(merged);
    return { ...unknownKeys(base, ITEM_KEYS), ...known };
  }

  function edgePlexus(id, patch) {
    const base = rawPlexus(id);
    const merged = { ...normalizeEdge(base), ...patch };
    return { ...unknownKeys(base, EDGE_KEYS), ...serializeEdge(merged) };
  }

  const clampSize = (type, w, h) => ({
    w: Math.max(MIN_SIZES[type]?.w ?? 1, w),
    h: Math.max(MIN_SIZES[type]?.h ?? 1, h),
  });

  function ensureContainer(t) {
    if (board.containerUid) return board.containerUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "edges");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
  }

  function refOf(id) {
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  }

  function edgeStringFor(from, to, dir, label) {
    return edgeString({ srcRef: refOf(from), dstRef: refOf(to), dir, label });
  }

  // ---- links ----
  function recomputeLinks(force) {
    if (!board) return;
    const filtered = filterLinks(allLinks, linkMode);
    const res = coveredBy(filtered, board);
    const fp = `${linkMode}|${res.visible.map((l) => l.key).join(",")}|${[...res.coveredEdges].sort().join(",")}`;
    const changed = fp !== linkFingerprint;
    visibleLinks = res.visible;
    covered = res.coveredEdges;
    linkFingerprint = fp;
    if (changed || force) emit("links", { links: visibleLinks, coveredEdges: covered });
  }

  function computeLinks() {
    if (!board) return;
    const boardEid = host.resolveEid({ uid });
    const eidToItems = new Map();
    for (const item of board.items.values()) {
      if (item.type !== "card") continue;
      const t = item.target;
      const ref = t.kind === "page" ? { title: t.title } : { uid: t.uid };
      const eid = host.resolveEid(ref);
      if (eid == null || eid === boardEid) continue;
      if (!eidToItems.has(eid)) eidToItems.set(eid, []);
      eidToItems.get(eid).push(item.uid);
    }
    const eids = [...eidToItems.keys()];
    if (!eids.length || boardEid == null) { allLinks = []; return; }
    const rows = host.q(linksQuery(), boardEid, eids, eids) || [];
    const parentStrings = new Map();
    let budget = MAX_PARENT_STRINGS;
    for (const row of rows) {
      const su = row[2];
      const ss = row[3];
      if (budget <= 0) break;
      if (attrNameOf(ss) == null && !parentStrings.has(su)) {
        budget--;
        const ps = host.parentString?.(su);
        if (ps != null) parentStrings.set(su, ps);
      }
    }
    allLinks = reduceLinks(rows, { eidToItems, parentStrings });
  }

  let linkTimer = null;
  let linkPromise = null;
  let linkResolve = null;
  function runLinks() {
    linkTimer = null;
    if (!destroyed) {
      try { computeLinks(); recomputeLinks(false); } catch (err) { console.error("[plexus session] links", err); }
    }
    const done = linkResolve;
    linkPromise = null;
    linkResolve = null;
    done?.();
  }
  function refreshLinks() {
    if (destroyed) return Promise.resolve();
    if (linkMode === "off") return Promise.resolve();
    if (!linkPromise) linkPromise = new Promise((resolve) => { linkResolve = resolve; });
    if (linkTimer) clearTimeout(linkTimer);
    linkTimer = setTimeout(() => runIdle(runLinks), linkDelay);
    linkTimer.unref?.();
    return linkPromise;
  }

  // ---- session object ----
  const session = {
    uid,
    host,
    settings,
    get board() { return board; },
    get rects() { return rects; },
    get links() { return visibleLinks; },
    get coveredEdges() { return covered; },
    get busy() { return busy; },
    get linkMode() { return linkMode; },

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },

    idle: () => queue.idle(),

    setLinkMode(mode) {
      if (!LINK_MODES.includes(mode)) return;
      linkMode = mode;
      recomputeLinks(true);
      if (mode !== "off" && !allLinks.length) refreshLinks();
    },
    refreshLinks,

    commitMove(uids, dx, dy) {
      if (!board || (!dx && !dy)) return Promise.resolve();
      return txn((t) => {
        const top = topLevelOf(board, uids);
        if (!top.length) return;
        const moved = new Map(rects);
        for (const id of top) {
          const r = rects.get(id);
          moved.set(id, { ...r, x: r.x + dx, y: r.y + dy });
        }
        const plan = new Map(membershipPlan(board, top, moved).map((p) => [p.uid, p]));
        for (const id of top) {
          const item = board.items.get(id);
          const p = plan.get(id);
          if (p) {
            t.move(id, p.toParent, "last");
            t.props(id, itemPlexus(id, { x: p.x, y: p.y }));
          } else {
            t.props(id, itemPlexus(id, { x: item.x + dx, y: item.y + dy }));
          }
        }
      });
    },

    commitRects(list) {
      if (!board || !list?.length) return Promise.resolve();
      return txn((t) => {
        const changedSections = [];
        for (const r of list) {
          const item = board.items.get(r.uid);
          if (!item) continue;
          const parentRect = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
          const size = clampSize(item.type, r.w ?? item.w, r.h ?? item.h);
          t.props(r.uid, itemPlexus(r.uid, {
            x: round1(r.x - parentRect.x),
            y: round1(r.y - parentRect.y),
            w: round1(size.w),
            h: round1(size.h),
          }));
          if (item.type === "section") changedSections.push(r.uid);
        }
        if (!changedSections.length) return;
        t.sync();
        for (const sid of changedSections) {
          const plan = sectionAdoptPlan(board, sid, rects);
          for (const p of plan) {
            t.move(p.uid, p.toParent, "last");
            t.props(p.uid, itemPlexus(p.uid, { x: p.x, y: p.y }));
          }
          if (plan.length) t.sync();
        }
      });
    },

    createCard({ x, y, string = "", w, h } = {}) {
      return txn((t) => {
        const size = { w: w ?? DEFAULT_SIZES.card.w, h: h ?? DEFAULT_SIZES.card.h };
        const parent = containerAt(board, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const layout = { x: rel.x, y: rel.y };
        if (w !== undefined) layout.w = w;
        if (h !== undefined) layout.h = h;
        return t.create({ parent, string, plexus: serializeItemLayout(layout) });
      });
    },

    createText({ x, y, string = "" } = {}) {
      return txn((t) => {
        const parent = containerAt(board, { x: x + DEFAULT_SIZES.text.w / 2, y: y + DEFAULT_SIZES.text.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        return t.create({ parent, string, plexus: serializeItemLayout({ type: "text", x: rel.x, y: rel.y }) });
      });
    },

    createSection({ rect, title = "Section", color } = {}) {
      return txn((t) => makeSection(t, rect, title, color, null));
    },

    wrapInSection(uids) {
      return txn((t) => {
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const pad = 32;
        const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        return makeSection(t, rect, "Section", undefined, top);
      });
    },

    addRefCards(list) {
      return txn((t) => (list ?? []).map(({ string, x, y }) => {
        const parent = containerAt(board, { x: x + DEFAULT_SIZES.card.w / 2, y: y + DEFAULT_SIZES.card.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        return t.create({ parent, string, plexus: serializeItemLayout({ x: rel.x, y: rel.y }) });
      }));
    },

    deleteItems(uids, { withContents = false } = {}) {
      return txn((t) => {
        const set = new Set([...uids].filter((id) => board.items.has(id)));
        if (!set.size) return;
        let edgeSet;
        if (withContents) {
          edgeSet = edgesTouching(board, set);
        } else {
          edgeSet = new Set();
          for (const e of board.edges.values()) if (set.has(e.from) || set.has(e.to)) edgeSet.add(e.uid);
          for (const id of set) {
            const item = board.items.get(id);
            if (item.type !== "section") continue;
            let survivor = item.parentUid;
            while (survivor !== uid && set.has(survivor)) survivor = board.items.get(survivor).parentUid;
            for (const m of item.members) {
              if (set.has(m)) continue;
              const r = rects.get(m);
              const rel = toRelative(board, survivor, { x: r.x, y: r.y }, rects);
              t.move(m, survivor, "last");
              t.props(m, itemPlexus(m, { x: rel.x, y: rel.y }));
            }
          }
        }
        for (const id of edgeSet) t.del(id);
        const explicit = withContents ? topLevelOf(board, set) : [...set].filter((id) => !set.has(board.items.get(id).parentUid));
        for (const id of explicit) t.del(id);
      });
    },

    setColor(uids, color) {
      return txn((t) => {
        for (const id of uids) {
          if (board.items.has(id)) t.props(id, itemPlexus(id, { color: color ?? undefined }));
          else if (board.edges.has(id)) t.props(id, edgePlexus(id, { color: color ?? undefined }));
        }
      });
    },

    setCollapsed(id, value) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
      });
    },

    setFontSize(id, size) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { fontSize: size }));
      });
    },

    setString(id, string) {
      return txn((t) => {
        const cur = rawNode(id)?.[STR];
        if (cur === undefined || cur === string) return;
        t.string(id, string);
      });
    },

    growToFit(id, contentHeight) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type === "section") return;
        const target = Math.min(900, Math.ceil(contentHeight));
        if (!(target > item.h)) return;
        t.props(id, itemPlexus(id, { h: target }));
      });
    },

    addEdge({ from, to, fromSide, toSide, label = "", dir = "one" } = {}) {
      return txn((t) => {
        if (!from || !to || from === to || !board.items.has(from) || !board.items.has(to)) return null;
        const existing = findEdge(board, from, to);
        if (existing && existing.dir === dir) return existing.uid;
        const container = ensureContainer(t);
        const props = serializeEdge({ from, to, dir, fromSide, toSide });
        return t.create({ parent: container, order: "last", string: edgeStringFor(from, to, dir, label), plexus: props });
      });
    },

    updateEdge(id, patch = {}) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        const { label, ...rest } = patch;
        const next = edgePlexus(id, rest);
        t.props(id, next);
        const dir = rest.dir ?? edge.dir;
        const nextLabel = label ?? edge.label;
        if (rest.dir !== undefined && rest.dir !== edge.dir || label !== undefined && label !== edge.label) {
          t.string(id, edgeStringFor(edge.from, edge.to, dir, nextLabel));
        }
      });
    },

    flipEdge(id) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        t.props(id, edgePlexus(id, { from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide }));
        t.string(id, edgeStringFor(edge.to, edge.from, edge.dir, edge.label));
      });
    },

    deleteEdges(uids) {
      return txn((t) => {
        for (const id of uids) if (board.edges.has(id)) t.del(id);
      });
    },

    pinLink(link) {
      const first = link?.labels?.[0];
      const label = first && first !== "mentions" ? first : "";
      return session.addEdge({ from: link.from, to: link.to, label, dir: "one" });
    },

    async writeToGraph(edgeUid) {
      const edge = board?.edges.get(edgeUid);
      if (!edge) return { ok: false, reason: "unresolved" };
      const label = String(edge.label ?? "").trim();
      if (!label) return { ok: false, reason: "empty-label" };
      if (label.includes("::")) return { ok: false, reason: "invalid-label" };
      if (/^BT_attr/i.test(label)) return { ok: false, reason: "reserved-label" };
      if (label.length > 60) return { ok: false, reason: "too-long" };
      const src = board.items.get(edge.from);
      const dst = board.items.get(edge.to);
      if (!src || !dst) return { ok: false, reason: "unresolved" };
      const dstRef = semanticRef(dst);
      try {
        if (src.kind === "page") {
          const page = host.pullPage(src.target.title);
          if (!page) return { ok: false, reason: "no-page" };
          const attr = kidsOf(page).find((k) => String(k[STR] ?? "").trim() === `${label}::`);
          if (attr) {
            await queue.run(() => host.createBlock({ parentUid: attr[UID], order: "last", string: dstRef }));
            return { ok: true, reason: "appended" };
          }
          await queue.run(() => host.createBlock({ parentUid: page[UID], order: "last", string: `${label}:: ${dstRef}` }));
          return { ok: true, reason: "created" };
        }
        const srcUid = src.kind === "block" ? src.target.uid : src.uid;
        if (host.blockString(srcUid) == null) return { ok: false, reason: "unresolved" };
        await queue.run(() => host.createBlock({ parentUid: srcUid, order: "last", string: `${label}:: ${dstRef}` }));
        return { ok: true, reason: "created" };
      } catch (err) {
        emit("toast", { message: "Couldn't write the connection to the graph." });
        return { ok: false, reason: "write-failed" };
      }
    },

    async undo() {
      try {
        await queue.run(async () => { ledger.clear(); await host.undo(); });
        repull();
      } catch (err) { handleFailure(err); }
    },

    async redo() {
      try {
        await queue.run(async () => { ledger.clear(); await host.redo(); });
        repull();
      } catch (err) { handleFailure(err); }
    },

    async enhance() {
      if (!board) return { enhanced: false, reason: "no-board" };
      if (board.enhanced) return { enhanced: false, reason: "already" };
      let source = readV06Entry(host, uid);
      let kind = "v06";
      if (!source) {
        const native = readNative(host, uid);
        source = native.nodes.length ? native : null;
        kind = source ? "native" : "none";
      }
      const plan = planImport(board, source, { gen: () => host.generateUid() });
      let counts = null;
      try {
        counts = await queue.run(async () => {
          ledger.clear();
          return executeImport(plan, host, board);
        });
      } catch (err) {
        handleFailure(err);
        return { enhanced: false, reason: "write-failed" };
      }
      repull();
      return { enhanced: true, kind, counts };
    },

    restoreNative() {
      return txn((t) => { t.props(uid, null); });
    },

    release() { /* replaced by acquireSession */ },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unwatch();
      if (linkTimer) clearTimeout(linkTimer);
      linkTimer = null;
      linkResolve?.();
      linkPromise = null;
      linkResolve = null;
      listeners.clear();
      ledger.clear();
    },
  };

  function makeSection(t, rect, title, color, adopt) {
    const parent = containerAt(board, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, { rects });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    const members = adopt ?? itemsInRect(board, rect, rects, { mode: "contain" });
    const size = clampSize("section", rect.w, rect.h);
    const sectionUid = t.create({
      parent,
      string: title,
      plexus: serializeItemLayout({ type: "section", x: rel.x, y: rel.y, w: size.w, h: size.h, color }),
    });
    for (const id of members) {
      if (id === sectionUid) continue;
      const r = rects.get(id);
      t.move(id, sectionUid, "last");
      t.props(id, itemPlexus(id, { x: round1(r.x - rect.x), y: round1(r.y - rect.y) }));
    }
    return sectionUid;
  }

  if (linkMode !== "off" && board) refreshLinks();
  return session;
}

export function acquireSession(boardUid, options = {}) {
  const { host } = options;
  const entry = registry.get(boardUid);
  if (entry && entry.host === host) {
    entry.refs++;
    return entry.session;
  }
  if (entry) {
    entry.session.destroy();
    registry.delete(boardUid);
  }
  const session = createSession(boardUid, options);
  const record = { host, session, refs: 1 };
  registry.set(boardUid, record);
  session.release = () => {
    if (registry.get(boardUid) !== record || record.refs <= 0) return;
    record.refs--;
    if (record.refs === 0) {
      session.destroy();
      registry.delete(boardUid);
    }
  };
  return session;
}

export function resetSessions() {
  for (const record of [...registry.values()]) record.session.destroy();
  registry.clear();
}
