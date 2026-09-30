import {
  boardPreview,
  boundsOf,
  buildBoard,
  containerAt,
  descendantsOf,
  diffBoards,
  edgesTouching,
  findEdge,
  itemsInRect,
  membershipPlan,
  outlineOrder,
  sectionAdoptPlan,
  sectionFitPlan,
  toRelative,
  topLevelOf,
  worldRects,
} from "./model/board.js";
import {
  BOARD_PATTERNS,
  BOARD_TONES,
  DEFAULT_BOARD_CARD,
  DEFAULT_SIZES,
  FIT_PAD,
  MIN_SIZES,
  SCHEMA_VERSION,
  attrNameOf,
  boardString,
  dailyPageTitle,
  edgeString,
  mergePropsForWrite,
  normalizeEdge,
  plainKeys,
  readPlexus,
  semanticRef,
  serializeEdge,
  serializeItemLayout,
  setBoardTitle,
  withBoardMarker,
} from "./model/schema.js";
import { inflate, rectsIntersect, unionRect } from "./model/geometry.js";
import { sameSize as sameSizeRects, spaceOut as spaceOutRects, tidyRects } from "./model/layout.js";
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
const ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize", "pinned", "fit"];
const EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color"];
const MAX_PARENT_STRINGS = 200;
const DAILY_GAP = 20;

const registry = new Map();
const extensions = [];

// Roam's undo stack holds 50 changes, so one bulk add stays under it: past 45 cards only the first 45 are made.
export const BULK_CARD_CAP = 45;
export function capBulk(list, emit) {
  if (list.length <= BULK_CARD_CAP) return list;
  emit("toast", { message: `Added ${BULK_CARD_CAP} of ${list.length} (Roam undo holds 50 changes)` });
  return list.slice(0, BULK_CARD_CAP);
}

// Registers fn(session, api); every session created afterwards runs it once before it is returned.
// Returns a function that removes the registration.
export function extendSession(fn) {
  if (typeof fn !== "function") return () => {};
  extensions.push(fn);
  return () => {
    const at = extensions.indexOf(fn);
    if (at >= 0) extensions.splice(at, 1);
  };
}

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
  const initialMode = typeof settings?.get === "function" ? settings.get("graph-links") : settings?.["graph-links"];
  let linkMode = LINK_MODES.includes(initialMode) ? initialMode : "all";
  const setting = (name, fallback) => {
    const v = typeof settings?.get === "function" ? settings.get(name) : settings?.[name];
    return v == null || v === "" ? fallback : v;
  };
  const flag = (name, fallback) => {
    const v = setting(name, fallback);
    return v === true || v === "true" ? true : v === false || v === "false" ? false : fallback;
  };
  const sizeSetting = (name, fallback) => {
    const n = Number(setting(name, fallback));
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  };
  const collapseOutline = () => (typeof settings?.get === "function" ? settings.get("collapse-outline") : settings?.["collapse-outline"]) !== false;

  // ---- raw tree helpers (optimistic model) ----
  const rawNode = (id) => (id === uid ? raw : ix().get(id)?.node ?? null);
  // New children go before the Connections container so it stays last (any board level, nested boards included).
  const insertOrder = (parentUid) => {
    const node = raw ? rawNode(parentUid) : null;
    if (!node) return "last";
    const at = kidsOf(node).findIndex((k) => readPlexus(k[PROPS])?.type === "edges");
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
    if (!board) return null;
    const diff = diffBoards(emitted, board);
    emitted = board;
    if (diff.structural || diff.dirty.size) emit("change", diff);
    recomputeLinks(false);
    if (diff.structural) refreshLinks();
    return diff;
  };

  // The board block itself vanished (deleted, or undone away): tell the owner once so it can pop out.
  let gone = false;
  const markGone = () => {
    if (gone || destroyed) return;
    gone = true;
    emit("gone", { uid });
  };
  const repull = () => {
    if (destroyed) return;
    const fresh = host.pullBoard(uid);
    if (!fresh) { markGone(); return; }
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
    const diff = publish();
    // Our own writes and their echoes are already in the optimistic model: a change that still shows up once the
    // queue is idle is someone else's edit, so the host's grouped undo log no longer maps onto Roam's stack (the host
    // ignores the call inside its own echo window).
    if (diff && (diff.structural || diff.dirty.size) && !queue.pending) host.invalidateUndo?.();
  };
  const unwatch = raw
    ? host.watchBoard(uid, (after) => {
      if (destroyed) return;
      if (!after || !after[UID]) {
        if (!host.pullBoard(uid)) markGone();
        return;
      }
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

  // One user operation is one Roam undo step: the host groups the writes of a transaction.
  const grouped = (fn) => (host.group ? host.group(fn) : fn());

  function commit(ops, result) {
    if (!ops.length) return Promise.resolve(result);
    const list = coalesce(ops);
    for (const op of list) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    return queue.run(() => grouped(() => execute(list))).then(() => result, (err) => { handleFailure(err); return result; });
  }

  function txn(fn) {
    if (!board || destroyed || gone) return Promise.resolve(undefined);
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

  // A section never goes below its members: keeps the frame's origin and grows the size to their padded far edges.
  const sectionFloor = (id, size) => {
    const item = board.items.get(id);
    const own = rects.get(id);
    if (item?.type !== "section" || !own || !item.members.length) return size;
    const b = boundsOf(item.members.map((m) => rects.get(m)).filter(Boolean));
    if (!b) return size;
    return { w: Math.max(size.w, b.x + b.w + FIT_PAD - own.x), h: Math.max(size.h, b.y + b.h + FIT_PAD - own.y) };
  };

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

  // ---- auto-fit ----
  // Grows auto-fit sections around the touched items (grow only), all inside the caller's txn. Grown sections
  // are written relative to their parent's final rect; direct members of a section whose origin moved are
  // rebased so their world positions stay put (this overwrites their earlier write in the same txn).
  function applyFit(t, touched, { skip } = {}) {
    if (!flag("auto-fit-sections", true)) return;
    const list = [...(touched ?? [])];
    if (!list.length) return;
    t.sync();
    const plan = sectionFitPlan(board, rects, list, skip ? { skip: new Set(skip) } : {});
    if (!plan.length) return;
    const grown = new Map(plan.map((p) => [p.uid, p.rect]));
    const finalWorld = new Map(rects);
    for (const [sid, r] of grown) finalWorld.set(sid, r);
    const originOf = (pid) => (pid === uid ? { x: 0, y: 0 } : finalWorld.get(pid) ?? { x: 0, y: 0 });
    for (const [sid, r] of grown) {
      const p = originOf(board.items.get(sid).parentUid);
      t.props(sid, itemPlexus(sid, { x: round1(r.x - p.x), y: round1(r.y - p.y), w: round1(r.w), h: round1(r.h) }));
    }
    for (const [sid, r] of grown) {
      const old = rects.get(sid);
      if (Math.abs(r.x - old.x) < 0.01 && Math.abs(r.y - old.y) < 0.01) continue;
      for (const m of board.items.get(sid).members) {
        if (grown.has(m)) continue;
        const mr = rects.get(m);
        t.props(m, itemPlexus(m, { x: round1(mr.x - r.x), y: round1(mr.y - r.y) }));
      }
    }
  }

  // Pushes overlapping siblings of just-moved items apart. Sections only take part when a section moved.
  function spaceOutAfter(t, moved) {
    t.sync();
    const byParent = new Map();
    for (const id of moved) {
      const it = board.items.get(id);
      if (!it) continue;
      if (!byParent.has(it.parentUid)) byParent.set(it.parentUid, []);
      byParent.get(it.parentUid).push(id);
    }
    const displacedIds = [];
    for (const [pid, here] of byParent) {
      const sibs = pid === uid ? board.roots : board.items.get(pid)?.members ?? [];
      const withSections = here.some((id) => board.items.get(id).type === "section");
      const map = new Map();
      const pinned = new Set();
      for (const s of sibs) {
        const it = board.items.get(s);
        if (!it || (it.type === "section" && !withSections)) continue;
        map.set(s, rects.get(s));
        if (it.pinned && !here.includes(s)) pinned.add(s);
      }
      const origin = pid === uid ? { x: 0, y: 0 } : rects.get(pid) ?? { x: 0, y: 0 };
      for (const d of spaceOutRects(map, new Set(here), { fixed: pinned })) {
        t.props(d.uid, itemPlexus(d.uid, { x: round1(d.x - origin.x), y: round1(d.y - origin.y) }));
        displacedIds.push(d.uid);
      }
    }
    applyFit(t, displacedIds);
  }

  const cardAt = (t, string, x, y) => {
    const parent = containerAt(board, { x: x + DEFAULT_SIZES.card.w / 2, y: y + DEFAULT_SIZES.card.h / 2 }, { rects });
    const rel = toRelative(board, parent, { x, y }, rects);
    return t.create({ parent, string, plexus: serializeItemLayout({ x: rel.x, y: rel.y }) });
  };

  const defaultSizeFor = (item) => {
    if (item.type === "section") return DEFAULT_SIZES.section;
    if (item.type === "text") return DEFAULT_SIZES.text;
    if (item.kind === "board") return DEFAULT_BOARD_CARD;
    return { w: sizeSetting("default-card-width", DEFAULT_SIZES.card.w), h: sizeSetting("default-card-height", DEFAULT_SIZES.card.h) };
  };

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
    get gone() { return gone; },
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
        const top = topLevelOf(board, uids).filter((id) => !board.items.get(id).pinned);
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
        applyFit(t, top);
        if (flag("space-out", false)) spaceOutAfter(t, top);
      });
    },

    commitRects(list) {
      if (!board || !list?.length) return Promise.resolve();
      return txn((t) => {
        const changedSections = [];
        const fitTouched = [];
        for (const r of list) {
          const item = board.items.get(r.uid);
          if (!item || item.pinned) continue;
          fitTouched.push(r.uid);
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
        if (changedSections.length) {
          t.sync();
          for (const sid of changedSections) {
            const plan = sectionAdoptPlan(board, sid, rects);
            for (const p of plan) {
              t.move(p.uid, p.toParent, "last");
              t.props(p.uid, itemPlexus(p.uid, { x: p.x, y: p.y }));
            }
            if (plan.length) t.sync();
          }
        }
        applyFit(t, fitTouched, { skip: changedSections });
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
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },

    createText({ x, y, string = "" } = {}) {
      return txn((t) => {
        const parent = containerAt(board, { x: x + DEFAULT_SIZES.text.w / 2, y: y + DEFAULT_SIZES.text.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const id = t.create({ parent, string, plexus: serializeItemLayout({ type: "text", x: rel.x, y: rel.y }) });
        applyFit(t, [id]);
        return id;
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

    createBoard({ rect, title } = {}) {
      return txn((t) => {
        const d = DEFAULT_BOARD_CARD;
        const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
        const size = clampSize("card", r.w, r.h);
        const id = makeBoard(t, { x: r.x, y: r.y, w: size.w, h: size.h }, title, undefined);
        applyFit(t, [id]);
        return id;
      });
    },

    wrapInBoard(uids) {
      return txn((t) => {
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const card = { x: b.x, y: b.y, w: Math.min(480, Math.max(240, b.w)), h: Math.min(360, Math.max(180, b.h)) };
        const boardUid = makeBoard(t, card, "", new Set(top), b);
        moveItemsInto(t, top, boardUid, { x: b.x, y: b.y }, { x: 0, y: 0 });
        applyFit(t, [boardUid]);
        return boardUid;
      });
    },

    moveIntoBoard(uids, boardUid) {
      if (!board || destroyed) return Promise.resolve(null);
      const target = board.items.get(boardUid);
      if (!target || target.kind !== "board" || !target.enhanced) return Promise.resolve(null);
      const top = topLevelOf(board, uids).filter((id) => id !== boardUid && !descendantsOf(board, id).has(boardUid));
      if (!top.length) return Promise.resolve(null);
      const preview = boardPreview(target);
      const cb = preview.bounds;
      const place = cb ? { x: cb.x + cb.w + 48, y: cb.y } : { x: 0, y: 0 };
      const origin = boundsOf(top.map((id) => rects.get(id)));
      const moved = new Set(top);
      for (const id of top) for (const d of descendantsOf(board, id)) moved.add(d);
      const undoItems = top.map((id) => {
        const hit = ix().get(id);
        return { uid: id, parentUid: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])) };
      }).sort((a, b) => a.order - b.order);
      const undoEdges = [];
      const info = { createdContainer: null };
      return txn((t) => {
        moveItemsInto(t, top, boardUid, origin, place, { moved, undoEdges, info });
        applyFit(t, [boardUid]);
        return {
          moved: top.slice(),
          title: target.title,
          boardUid,
          undo: () => txn((u) => {
            for (const it of undoItems) {
              u.move(it.uid, it.parentUid, it.order);
              u.props(it.uid, it.plexus);
            }
            for (const e of undoEdges.sort((a, b) => a.order - b.order)) {
              if (e.deleted) u.create({ uid: e.uid, parent: e.parent, order: e.order, string: e.string, plexus: e.plexus });
              else {
                if (e.relocated) u.move(e.uid, e.parent, e.order);
                u.props(e.uid, e.plexus);
                u.string(e.uid, e.string);
              }
            }
            if (info.createdContainer) u.del(info.createdContainer);
          }),
        };
      });
    },

    renameBoard(id, title) {
      return txn((t) => {
        const cur0 = board.items.get(id);
        if (cur0?.kind !== "board" || !cur0.enhanced) return;
        const cur = rawNode(id)?.[STR];
        if (cur === undefined) return;
        const next = setBoardTitle(cur, title);
        if (next !== cur) t.string(id, next);
      });
    },

    addRefCards(list) {
      const items = capBulk(list ?? [], emit);
      return txn((t) => {
        const ids = items.map(({ string, x, y }) => cardAt(t, string, x, y));
        applyFit(t, ids);
        return ids;
      });
    },

    deleteItems(uids, { withContents = false, force = false } = {}) {
      return txn((t) => {
        const protectedItem = (id) => board.items.get(id).pinned
          || (withContents && [...descendantsOf(board, id)].some((d) => board.items.get(d).pinned));
        const set = new Set([...uids].filter((id) => board.items.has(id) && (force || !protectedItem(id))));
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
        applyFit(t, [id]);
      });
    },

    fitSection(id, { shrink = true } = {}) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section" || !item.members.length) return false;
        const own = rects.get(id);
        const bounds = boundsOf(item.members.map((m) => rects.get(m)));
        let next = inflate(bounds, FIT_PAD);
        if (!shrink) next = unionRect(own, next);
        const size = clampSize("section", next.w, next.h);
        next = { x: round1(next.x), y: round1(next.y), w: round1(size.w), h: round1(size.h) };
        const origin = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
        const write = (target, patch) => {
          const plexus = itemPlexus(target, patch);
          if (stable(plexus) !== stable(rawPlexus(target))) t.props(target, plexus);
        };
        write(id, { x: round1(next.x - origin.x), y: round1(next.y - origin.y), w: next.w, h: next.h });
        for (const m of item.members) {
          const mr = rects.get(m);
          write(m, { x: round1(mr.x - next.x), y: round1(mr.y - next.y) });
        }
        applyFit(t, [id]);
        return true;
      });
    },

    setFit(id, on) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section") return;
        const want = on === false ? false : undefined;
        if ((item.autofit === false) === (want === false)) return;
        t.props(id, itemPlexus(id, { fit: want }));
      });
    },

    setPinned(uids, on) {
      return txn((t) => {
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned === Boolean(on)) continue;
          t.props(id, itemPlexus(id, { pinned: on ? true : undefined }));
        }
      });
    },

    // bg / bgColor: undefined leaves the key, null removes it, otherwise it must be a known pattern / tone.
    // Resolves true when applied (or already equal), false when rejected.
    setBoardBackground({ bg, bgColor } = {}) {
      return txn((t) => {
        if (!board.enhanced) return false;
        if (bg != null && !BOARD_PATTERNS.includes(bg)) return false;
        if (bgColor != null && !BOARD_TONES.includes(bgColor)) return false;
        const base = rawPlexus(uid);
        const next = { ...base };
        for (const [key, value] of [["bg", bg], ["bgColor", bgColor]]) {
          if (value === undefined) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },

    setCollapsedMany(uids, value) {
      return txn((t) => {
        let count = 0;
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.type !== "card" || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
          count++;
        }
        return count;
      });
    },

    collapseAll(value, { within = null, except = [] } = {}) {
      return txn((t) => {
        const skipIds = new Set(except ?? []);
        const pool = within ? [...descendantsOf(board, within)] : [...board.items.keys()];
        let count = 0;
        for (const id of pool) {
          const item = board.items.get(id);
          if (!item || item.type !== "card" || skipIds.has(id) || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
          count++;
        }
        return count;
      });
    },

    // Modes: row, column, grid, outline. A lone selected section tidies its members; otherwise each parent's
    // selected items are tidied among themselves. Writes only x and y. Resolves the number of items moved.
    tidyItems(uids, mode = "grid", { gap } = {}) {
      return txn((t) => {
        const top = topLevelOf(board, uids ?? []);
        const groups = new Map();
        if (top.length === 1 && board.items.get(top[0]).type === "section") {
          groups.set(top[0], board.items.get(top[0]).members.filter((m) => !board.items.get(m).pinned));
        } else {
          for (const id of top) {
            const it = board.items.get(id);
            if (it.pinned) continue;
            if (!groups.has(it.parentUid)) groups.set(it.parentUid, []);
            groups.get(it.parentUid).push(id);
          }
        }
        const opts = gap !== undefined ? { gap } : {};
        if (mode === "outline") opts.order = outlineOrder(board);
        const moved = [];
        for (const ids of groups.values()) {
          if (ids.length < 2) continue;
          const list = ids.map((id) => {
            const it = board.items.get(id);
            return { uid: id, x: it.x, y: it.y, w: it.w, h: it.h };
          });
          for (const p of tidyRects(list, mode, opts)) {
            const it = board.items.get(p.uid);
            if (Math.abs(p.x - it.x) < 0.05 && Math.abs(p.y - it.y) < 0.05) continue;
            t.props(p.uid, itemPlexus(p.uid, { x: round1(p.x), y: round1(p.y) }));
            moved.push(p.uid);
          }
        }
        applyFit(t, moved);
        return moved.length;
      });
    },

    sameSize(uids, primaryUid, mode = "both") {
      return txn((t) => {
        const ids = [...new Set([...(uids ?? []), primaryUid])].filter((id) => board.items.has(id));
        const list = ids.map((id) => ({ uid: id, w: board.items.get(id).w, h: board.items.get(id).h }));
        const changed = [];
        for (const c of sameSizeRects(list, primaryUid, mode)) {
          const item = board.items.get(c.uid);
          if (item.pinned) continue;
          const size = sectionFloor(c.uid, clampSize(item.type, c.w, c.h));
          if (round1(size.w) === item.w && round1(size.h) === item.h) continue;
          t.props(c.uid, itemPlexus(c.uid, { w: round1(size.w), h: round1(size.h) }));
          changed.push(c.uid);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },

    resetSize(uids) {
      return txn((t) => {
        const changed = [];
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned) continue;
          const d = sectionFloor(id, defaultSizeFor(item));
          const w = round1(d.w);
          const h = round1(d.h);
          if (item.w === w && item.h === h) continue;
          t.props(id, itemPlexus(id, { w, h }));
          changed.push(id);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },

    // Sets the height from measured content, shrinking as well as growing (growToFit only grows).
    fitToContent(id, contentHeight) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type === "section" || !Number.isFinite(contentHeight)) return;
        const target = Math.min(900, Math.max(MIN_SIZES[item.type]?.h ?? 1, Math.ceil(contentHeight)));
        if (target === item.h) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },

    addDailyCards(dates, { x = 0, y = 0 } = {}) {
      return txn((t) => {
        const have = new Set();
        for (const item of board.items.values()) if (item.kind === "page") have.add(item.target.title);
        const made = [];
        // Cards land in a row from the click point, skipping any spot an existing (or just placed) card occupies.
        const size = defaultSizeFor({ type: "card", kind: "page" });
        const occupied = [...board.items.values()].filter((it) => it.type !== "section").map((it) => rects.get(it.uid)).filter(Boolean);
        let slotX = x;
        const freeSlot = () => {
          const at = () => ({ x: slotX, y, w: size.w, h: size.h });
          while (occupied.some((r) => rectsIntersect(r, at()))) slotX += size.w + DAILY_GAP;
          const spot = at();
          occupied.push(spot);
          slotX += size.w + DAILY_GAP;
          return spot.x;
        };
        for (const d of dates ?? []) {
          const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
            ? new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
            : d;
          const title = dailyPageTitle(date);
          if (have.has(title)) continue;
          have.add(title);
          made.push(cardAt(t, `[[${title}]]`, freeSlot(), y));
        }
        applyFit(t, made);
        return made;
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
      // Roam skips a collapsed block's children, so an open board with an outline is collapsed in the same run.
      const collapse = collapseOutline() && raw?.[OPEN] !== false;
      let counts = null;
      try {
        counts = await queue.run(() => grouped(async () => {
          ledger.clear();
          const done = await executeImport(plan, host, board);
          if (collapse) await host.setOpen(uid, false);
          return done;
        }));
      } catch (err) {
        handleFailure(err);
        return { enhanced: false, reason: "write-failed" };
      }
      repull();
      return { enhanced: true, kind, counts };
    },

    restoreNative() {
      return txn((t) => { t.props(uid, withBoardMarker(rawPlexus(uid), false)); });
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

  // A nested board is one card block: the board string plus its layout and `v: 2` in a single create.
  function makeBoard(t, rect, title, exclude, centerOf = rect) {
    const parent = containerAt(board, { x: centerOf.x + centerOf.w / 2, y: centerOf.y + centerOf.h / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    return t.create({
      parent,
      string: boardString(title),
      plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: rect.w, h: rect.h, v: SCHEMA_VERSION }),
      open: collapseOutline() ? false : undefined,
    });
  }

  // Moves top-level items into a child board (rebased to its origin) and re-homes the connections that follow.
  function moveItemsInto(t, top, boardUid, origin, place, track = {}) {
    const moved = track.moved ?? new Set([...top].flatMap((id) => [id, ...descendantsOf(board, id)]));
    for (const id of top) {
      const r = rects.get(id);
      t.move(id, boardUid, insertOrder(boardUid));
      t.props(id, itemPlexus(id, { x: round1(r.x - origin.x + place.x), y: round1(r.y - origin.y + place.y) }));
    }
    let childContainer = null;
    const childEdges = () => {
      if (childContainer) return childContainer;
      const existing = kidsOf(rawNode(boardUid)).find((k) => readPlexus(k[PROPS])?.type === "edges");
      if (existing) { childContainer = existing[UID]; return childContainer; }
      childContainer = t.create({ parent: boardUid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
      if (track.info) track.info.createdContainer = childContainer;
      return childContainer;
    };
    const taken = new Set();
    // Snapshot first: moving one edge out renumbers its siblings, and undo needs the original positions.
    const touched = [...board.edges.values()].filter((e) => moved.has(e.from) || moved.has(e.to));
    const snapshots = new Map();
    for (const e of touched) {
      const hit = ix().get(e.uid);
      if (hit?.parent) {
        snapshots.set(e.uid, { uid: e.uid, parent: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])), string: hit.node[STR] ?? "" });
      }
    }
    for (const e of touched) {
      const snapshot = snapshots.get(e.uid);
      if (snapshot) track.undoEdges?.push(snapshot);
      if (moved.has(e.from) && moved.has(e.to)) {
        if (snapshot) snapshot.relocated = true;
        t.move(e.uid, childEdges(), "last");
        continue;
      }
      const from = moved.has(e.from) ? boardUid : e.from;
      const to = moved.has(e.to) ? boardUid : e.to;
      const dup = findEdge(board, from, to);
      const key = `${from}>${to}`;
      if (from === to || (dup && dup.uid !== e.uid) || taken.has(key)) {
        if (snapshot) snapshot.deleted = true;
        t.del(e.uid);
        continue;
      }
      taken.add(key);
      t.props(e.uid, edgePlexus(e.uid, { from, to, fromSide: moved.has(e.from) ? "auto" : e.fromSide, toSide: moved.has(e.to) ? "auto" : e.toSide }));
      t.string(e.uid, edgeStringFor(from, to, e.dir, e.label));
    }
  }

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

  const api = {
    uid,
    host,
    settings,
    txn,
    rawNode,
    ix,
    kidsOf,
    rawPlexus,
    itemPlexus,
    edgePlexus,
    insertOrder,
    ensureContainer,
    edgeStringFor,
    refOf,
    applyFit,
    board: () => board,
    rects: () => rects,
    queue,
    isGone: () => gone || destroyed,
    setting,
    clone,
    round1,
    emit,
  };
  for (const fn of [...extensions]) {
    try { fn(session, api); } catch (err) { console.error("[plexus session] extension", err); }
  }
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
