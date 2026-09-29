/* Plexus Diagram v1.1.0 | MIT | generated; edit src/ */

// src/lifecycle.js
function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}
async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}
function createLifecycle() {
  let disposed = false;
  const disposers = [];
  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[plexus-diagram] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };
  return {
    get disposed() {
      return disposed;
    },
    add,
    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },
    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },
    interval(callback, delay, ...args) {
      const id = globalThis.setInterval(callback, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },
    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },
    observer(observer, target, options) {
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },
    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
    },
    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      dataApi.addPullWatch(pattern, entity, callback);
      add(() => dataApi.removePullWatch(pattern, entity, callback));
      return callback;
    },
    async settingsPanel(extensionAPI, config) {
      await extensionAPI.settings.panel.create(config);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    }
  };
}

// package.json
var package_default = {
  name: "plexus-diagram",
  version: "1.1.0",
  private: true,
  description: "Heptabase-style whiteboard for Roam {{[[diagram]]}} blocks: cards, colored sections, and connections that are real Roam blocks and links",
  type: "module",
  main: "extension.js",
  scripts: {
    build: "node build.mjs",
    dev: "node build.mjs --watch",
    "scan:secrets": "node scripts/scan-secrets.mjs",
    test: "node --test test/*.test.js",
    "verify:generated": "node scripts/verify-generated.mjs",
    check: "npm run build && npm run scan:secrets && node --check extension.js && npm test && npm run verify:generated"
  },
  engines: {
    node: ">=20"
  },
  devDependencies: {
    esbuild: "0.28.1"
  },
  license: "MIT"
};

// src/model/schema.js
var PLEXUS_KEY = "plexus";
var SCHEMA_VERSION = 2;
var PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
var ITEM_TYPES = ["card", "section", "text"];
var DEFAULT_SIZES = { card: { w: 280, h: 160 }, section: { w: 480, h: 320 }, text: { w: 240, h: 48 } };
var MIN_SIZES = { card: { w: 200, h: 80 }, section: { w: 160, h: 100 }, text: { w: 60, h: 24 } };
var DEFAULT_BOARD_CARD = { w: 320, h: 220 };
var UNTITLED_BOARD = "Untitled board";
var FONT_SIZES = [16, 24, 32, 48];
var EDGE_DEFAULTS = { fromSide: "auto", toSide: "auto", dir: "one", route: "curve", dash: "solid", weight: 1 };
var SIDES = ["auto", "top", "right", "bottom", "left"];
var ARROWS = { one: "→", two: "↔", none: "—" };
var ARROW_TOKENS = Object.values(ARROWS);
var BOARD_BACKGROUNDS = ["dots", "lines", "plain"];
var ROUTES = ["curve", "straight", "elbow"];
var DASHES = ["solid", "dashed"];
var DIRS = ["one", "two", "none"];
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function plainKeys(value) {
  if (Array.isArray(value)) return value.map(plainKeys);
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.startsWith(":") ? k.slice(1) : k] = plainKeys(v);
    }
    return out;
  }
  return value;
}
function readPlexus(props) {
  if (!isObject(props)) return null;
  const plexus = plainKeys(props)[PLEXUS_KEY];
  return isObject(plexus) ? plexus : null;
}
function mergePropsForWrite(props, plexus) {
  const out = isObject(props) ? plainKeys(props) : {};
  if (plexus == null) delete out[PLEXUS_KEY];
  else out[PLEXUS_KEY] = plainKeys(plexus);
  return out;
}
function normalizeItemLayout(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const num2 = (v) => isNum(v) ? v : void 0;
  return {
    type: ITEM_TYPES.includes(p.type) ? p.type : "card",
    x: num2(p.x),
    y: num2(p.y),
    w: num2(p.w),
    h: num2(p.h),
    color: PALETTE.includes(p.color) ? p.color : void 0,
    collapsed: p.collapsed === true ? true : p.collapsed === false ? false : void 0,
    fontSize: FONT_SIZES.includes(p.fontSize) ? p.fontSize : void 0
  };
}
var round1 = (n) => Math.round(n * 10) / 10;
function serializeItemLayout(layout) {
  const l = isObject(layout) ? layout : {};
  const out = {};
  if (l.type && l.type !== "card") out.type = l.type;
  for (const k of ["x", "y", "w", "h"]) if (isNum(l[k])) out[k] = round1(l[k]);
  if (PALETTE.includes(l.color)) out.color = l.color;
  if (l.collapsed === true) out.collapsed = true;
  if (l.type === "text" && FONT_SIZES.includes(l.fontSize)) out.fontSize = l.fontSize;
  if (l.v === SCHEMA_VERSION) out.v = SCHEMA_VERSION;
  if (BOARD_BACKGROUNDS.includes(l.bg)) out.bg = l.bg;
  return out;
}
function withBoardMarker(plexus, on) {
  const base = isObject(plexus) ? plainKeys(plexus) : {};
  if (on) return { ...base, v: SCHEMA_VERSION };
  delete base.v;
  delete base.bg;
  return Object.keys(base).length ? base : null;
}
function normalizeEdge(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const pick = (v, list, def) => list.includes(v) ? v : def;
  return {
    from: typeof p.from === "string" ? p.from : "",
    to: typeof p.to === "string" ? p.to : "",
    fromSide: pick(p.fromSide, SIDES, EDGE_DEFAULTS.fromSide),
    toSide: pick(p.toSide, SIDES, EDGE_DEFAULTS.toSide),
    dir: pick(p.dir, DIRS, EDGE_DEFAULTS.dir),
    route: pick(p.route, ROUTES, EDGE_DEFAULTS.route),
    dash: pick(p.dash, DASHES, EDGE_DEFAULTS.dash),
    weight: [1, 2, 3].includes(p.weight) ? p.weight : EDGE_DEFAULTS.weight,
    color: PALETTE.includes(p.color) ? p.color : void 0
  };
}
function serializeEdge(edge) {
  const e = isObject(edge) ? edge : {};
  const out = { type: "edge", from: e.from, to: e.to };
  for (const k of ["fromSide", "toSide", "dir", "route", "dash", "weight"]) {
    if (e[k] !== void 0 && e[k] !== EDGE_DEFAULTS[k]) out[k] = e[k];
  }
  if (PALETTE.includes(e.color)) out.color = e.color;
  return out;
}
function isSingleWikiRef(s) {
  if (!s.startsWith("[[") || !s.endsWith("]]") || s.length < 5) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) {
      depth++;
      i++;
    } else if (s.startsWith("]]", i)) {
      depth--;
      i++;
      if (depth === 0 && i !== s.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}
function classifyString(s) {
  const t = String(s ?? "").trim();
  if (isSingleWikiRef(t)) return { kind: "page", title: t.slice(2, -2) };
  if (t.startsWith("#[[") && isSingleWikiRef(t.slice(1))) return { kind: "page", title: t.slice(3, -2) };
  const tag = /^#([^\s[\]#]+)$/.exec(t);
  if (tag) return { kind: "page", title: tag[1] };
  const block = /^\(\(([\w-]+)\)\)$/.exec(t);
  if (block) return { kind: "block", refUid: block[1] };
  if (/^\{\{(\[\[)?diagram/i.test(t)) return { kind: "board" };
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(t)) return { kind: "image" };
  return { kind: "note" };
}
function parseBoardTitle(s) {
  const m = /^\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?\s*:([\s\S]*?)\}\}\s*$/i.exec(String(s ?? ""));
  return m ? m[1].trim() : "";
}
var cleanBoardTitle = (title) => String(title ?? "").replace(/\s*[\r\n]+\s*/g, " ").split("}}").join("").trim();
function boardString(title) {
  return `{{[[diagram]]:${cleanBoardTitle(title) || UNTITLED_BOARD}}}`;
}
function setBoardTitle(s, title) {
  const cur = String(s ?? "");
  const m = /^(\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?)\s*(?::[^}]*)?\}\}/i.exec(cur);
  if (!m) return boardString(title);
  return `${m[1]}:${cleanBoardTitle(title) || UNTITLED_BOARD}}}${cur.slice(m[0].length)}`;
}
function isUntitledBoard(title) {
  const t = String(title ?? "").trim().toLowerCase();
  return t === "" || t === UNTITLED_BOARD.toLowerCase();
}
function plainText(s, max = 200) {
  let t = String(s ?? "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^[\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\(\([\w-]+\)\)/g, "");
  t = t.replace(/\{\{[^}]*\}\}/g, "");
  let prev;
  do {
    prev = t;
    t = t.replace(/#?\[\[([^[\]]*)\]\]/g, "$1");
  } while (t !== prev);
  t = t.replace(/(^|\s)#([^\s#]+)/g, "$1$2");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/\^\^(.+?)\^\^/g, "$1").replace(/~~(.+?)~~/g, "$1").replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return t;
}
function firstLine(s) {
  const line = String(s ?? "").split("\n").find((l) => l.trim() !== "");
  return line === void 0 ? "" : plainText(line);
}
function semanticRef(item) {
  const t = item?.target;
  if (t?.kind === "page") return `[[${t.title}]]`;
  if (t?.kind === "block") return `((${t.refUid ?? t.uid}))`;
  return `((${item?.uid}))`;
}
function edgeString({ srcRef, dstRef, dir = "one", label = "" }) {
  const a = ARROWS[dir] ?? ARROWS.one;
  return label ? `${srcRef} ${a} ${label} ${a} ${dstRef}` : `${srcRef} ${a} ${dstRef}`;
}
function parseEdgeLabel(s, srcRef, dstRef) {
  const str2 = String(s ?? "").trim();
  if (srcRef && dstRef) {
    let rest = null;
    for (const a of ARROW_TOKENS) {
      const prefix = `${srcRef} ${a} `;
      if (str2.startsWith(prefix)) {
        rest = str2.slice(prefix.length);
        break;
      }
    }
    if (rest !== null) {
      if (rest === dstRef) return "";
      for (const b of ARROW_TOKENS) {
        const suffix = ` ${b} ${dstRef}`;
        if (rest.endsWith(suffix)) return rest.slice(0, rest.length - suffix.length).trim();
      }
    }
  }
  let out = str2;
  for (const token of [srcRef, dstRef, ...ARROW_TOKENS]) {
    if (token) out = out.split(token).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}
function colorForLabel(label) {
  if (label == null || label === "" || label === "mentions") return "gray";
  let h = 2166136261;
  const str2 = String(label);
  for (let i = 0; i < str2.length; i++) {
    h ^= str2.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PALETTE[1 + h % 9];
}
function attrNameOf(s) {
  if (typeof s !== "string") return null;
  const m = /^\s*([^:\n]{1,60})::/.exec(s);
  if (!m) return null;
  const name = m[1].trim();
  return name ? name : null;
}

// src/host/roam.js
var BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/props
     {:block/children ...}]}]}]`;
var ciPattern = (text) => `(?i)${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
var NATIVE_PATTERN = `[{:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;
var eidKey = (uid) => [":block/uid", uid];
var watchEntity = (uid) => `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function trimTree(node, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids(node)) {
    if (budget.left <= 0) break;
    budget.left--;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
      children: trimTree(c, depth - 1, budget)
    });
  }
  return out;
}
function graphName(hash = globalThis.location?.hash ?? "") {
  const m = /#\/app\/([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]) : "";
}
function createWriteQueue({ onBusy } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  let waiters = [];
  return {
    run(fn) {
      pending++;
      if (pending === 1) onBusy?.(true);
      const p = tail.then(async () => {
        try {
          return await fn();
        } finally {
          pending--;
          if (pending === 0) {
            onBusy?.(false);
            const w = waiters;
            waiters = [];
            w.forEach((r) => r());
          }
        }
      });
      tail = p.then(() => {
      }, () => {
      });
      return p;
    },
    get pending() {
      return pending;
    },
    idle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    }
  };
}
var canon = (v) => typeof v === "string" ? v : JSON.stringify(v);
function createEchoLedger({ graceMs = 800, now: now2 = Date.now } = {}) {
  const state = /* @__PURE__ */ new Map();
  const keyOf = (uid, field) => `${uid}\0${field}`;
  const get = (uid, field, create) => {
    const k = keyOf(uid, field);
    let s = state.get(k);
    if (!s && create) {
      s = { uid, field, pending: [], inflight: 0, graceUntil: 0 };
      state.set(k, s);
    }
    return s;
  };
  return {
    expect(uid, field, value) {
      const s = get(uid, field, true);
      s.pending.push(canon(value));
      s.inflight++;
    },
    settle(uid, field) {
      const s = get(uid, field, false);
      if (!s) return;
      s.inflight = Math.max(0, s.inflight - 1);
      if (s.inflight === 0) s.graceUntil = now2() + graceMs;
    },
    accept(uid, field, value) {
      const k = keyOf(uid, field);
      const s = state.get(k);
      if (!s) return true;
      const v = canon(value);
      const idle = s.inflight === 0;
      if (idle && now2() >= s.graceUntil) {
        state.delete(k);
        return true;
      }
      const idx = s.pending.lastIndexOf(v);
      if (idx >= 0 && idx === s.pending.length - 1) {
        s.pending = [];
        if (idle) s.graceUntil = now2() + graceMs;
        return false;
      }
      return false;
    },
    tracked() {
      return [...state.values()].map((s) => [s.uid, s.field]);
    },
    pendingCount(uid) {
      let n = 0;
      for (const s of state.values()) if (s.uid === uid) n += s.pending.length + s.inflight;
      return n;
    },
    clear() {
      state.clear();
    }
  };
}
function createViewportStore({ storage = globalThis.localStorage, graph = "", now: now2 = Date.now } = {}) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const lastWrite = /* @__PURE__ */ new Map();
  const latest = /* @__PURE__ */ new Map();
  const timers = /* @__PURE__ */ new Map();
  const flush = (uid) => {
    timers.delete(uid);
    if (!latest.has(uid)) return;
    try {
      storage?.setItem(key(uid), JSON.stringify(latest.get(uid)));
    } catch {
    }
    lastWrite.set(uid, now2());
    latest.delete(uid);
  };
  return {
    get(uid) {
      try {
        const raw = storage?.getItem(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch {
        return null;
      }
    },
    set(uid, vp) {
      if (!vp) return;
      latest.set(uid, { x: vp.x, y: vp.y, zoom: vp.zoom });
      const since = now2() - (lastWrite.get(uid) ?? -Infinity);
      if (since >= 500) {
        flush(uid);
        return;
      }
      if (!timers.has(uid)) {
        const t = setTimeout(() => flush(uid), 500 - since);
        t.unref?.();
        timers.set(uid, t);
      }
    },
    flushAll() {
      for (const [uid, t] of timers) {
        clearTimeout(t);
        flush(uid);
      }
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      latest.clear();
    }
  };
}
function createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph } = {}) {
  const stats = { writes: 0, watches: 0, renders: 0 };
  const data = api.data;
  const pull = (pattern, entity) => data.pull(pattern, entity);
  const gname = graph ?? graphName();
  const host = {
    api,
    stats,
    viewports: createViewportStore({ storage, graph: gname }),
    pullBoard(uid) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res && res[":block/uid"] ? res : null;
    },
    watchBoard(uid, cb) {
      const entity = watchEntity(uid);
      const wrapped = (before, after) => cb(after);
      data.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.watches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(BOARD_PATTERN, entity, wrapped);
        stats.watches--;
      };
    },
    pullNative(uid) {
      return pull(NATIVE_PATTERN, eidKey(uid)) ?? null;
    },
    pullProps(uid) {
      const res = pull("[:block/props]", eidKey(uid));
      const props = res?.[":block/props"];
      return props && typeof props === "object" ? plainKeys(props) : {};
    },
    pullTree(uid, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res ? trimTree(res, depth, { left: limit }) : [];
    },
    pullPage(title) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      return res && res[":block/uid"] ? res : null;
    },
    pagePreview(title, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, depth, { left: limit }) };
    },
    pageUid(title) {
      const res = pull("[:block/uid]", [":node/title", title]);
      return res?.[":block/uid"] ?? null;
    },
    cardStringForUid(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      let res;
      try {
        res = pull("[:block/uid :node/title]", eidKey(id));
      } catch {
        return null;
      }
      if (!res?.[":block/uid"]) return null;
      const title = res[":node/title"];
      return typeof title === "string" && title ? `[[${title}]]` : `((${id}))`;
    },
    blockString(uid) {
      const res = pull("[:block/string]", eidKey(uid));
      return typeof res?.[":block/string"] === "string" ? res[":block/string"] : null;
    },
    parentString(uid) {
      const res = pull("[{:block/_children [:block/string]}]", eidKey(uid));
      const p = res?.[":block/_children"];
      const first = Array.isArray(p) ? p[0] : p;
      return typeof first?.[":block/string"] === "string" ? first[":block/string"] : null;
    },
    resolveEid(ref) {
      const entity = ref?.uid ? eidKey(ref.uid) : ref?.title ? [":node/title", ref.title] : null;
      if (!entity) return null;
      const res = pull("[:db/id]", entity);
      return res?.[":db/id"] ?? null;
    },
    generateUid() {
      return api.util.generateUID();
    },
    async createBlock({ parentUid, order = "last", uid, string = "", props, open } = {}) {
      const id = uid ?? api.util.generateUID();
      const block = { uid: id, string };
      if (props !== void 0) block.props = plainKeys(props);
      if (open !== void 0) block.open = open;
      stats.writes++;
      await data.block.create({ location: { "parent-uid": parentUid, order }, block });
      return id;
    },
    async updateString(uid, string) {
      stats.writes++;
      await data.block.update({ block: { uid, string } });
    },
    async updateProps(uid, plexus) {
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await data.block.update({ block: { uid, props: merged } });
    },
    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } });
    },
    async deleteBlock(uid) {
      stats.writes++;
      await data.block.delete({ block: { uid } });
    },
    async setOpen(uid, open) {
      stats.writes++;
      await data.block.update({ block: { uid, open } });
    },
    undo() {
      return data.undo();
    },
    redo() {
      return data.redo();
    },
    openInSidebar(uid, type = "block") {
      return api.ui.rightSidebar.addWindow({ window: { type, "block-uid": uid } });
    },
    openBlock(uid) {
      return api.ui.mainWindow.openBlock({ block: { uid } });
    },
    renderString(el, string) {
      stats.renders++;
      return api.ui.components.renderString({ el, string });
    },
    renderBlock(el, uid) {
      stats.renders++;
      return api.ui.components.renderBlock({ uid, el, "open?": true });
    },
    renderPage(el, uid) {
      stats.renders++;
      return api.ui.components.renderPage({ uid, el });
    },
    unmount(el) {
      return api.ui.components.unmountNode({ el });
    },
    q(query, ...inputs) {
      return data.fast?.q ? data.fast.q(query, ...inputs) : data.q(query, ...inputs);
    },
    searchPages(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?t ?u :in $ ?pat :where [?p :node/title ?t] [(re-pattern ?pat) ?re] [(re-find ?re ?t)] [?p :block/uid ?u]]`,
        ciPattern(needle)
      ) || [];
      return rows.filter(([t]) => typeof t === "string" && !t.startsWith("roam/")).map(([t, u]) => ({ uid: u, title: t })).sort((a, b) => {
        const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || a.title.length - b.title.length || a.title.localeCompare(b.title);
      }).slice(0, limit);
    },
    searchBlocks(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?s ?u ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        ciPattern(needle)
      ) || [];
      return rows.filter(([, , t]) => typeof t === "string" && !t.startsWith("roam/")).slice(0, limit).map(([s, u, t]) => ({ uid: u, string: s, pageTitle: t }));
    },
    // Graph neighbours of a card target, ordered for the Related panel:
    // attribute relations (both directions) → pages it links to → pages that link to it (grouped, counted).
    // The attribute-name page itself is not a neighbour, and blocks inside the current board are skipped.
    related(ref, limit = 60, { boardUid } = {}) {
      if (!ref || (ref.kind === "page" ? !ref.title : !ref.uid)) return [];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const byPage = ref.kind === "page";
      const outgoing = host.q(
        byPage ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]` : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
        byPage ? ref.title : ref.uid
      ) || [];
      const incoming = host.q(
        byPage ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]` : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
        byPage ? ref.title : ref.uid,
        boardEid
      ) || [];
      const attrs = [];
      const links = [];
      const pages = /* @__PURE__ */ new Map();
      const seen = /* @__PURE__ */ new Set();
      const add = (list, relation, target, text) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ relation, target, text });
      };
      for (const [rt, ss] of outgoing) {
        const attr = attrNameOf(ss);
        if (attr && rt === attr) continue;
        if (byPage && rt === ref.title) continue;
        if (attr) add(attrs, `${attr} →`, { kind: "page", title: rt }, rt);
        else add(links, "links to", { kind: "page", title: rt }, rt);
      }
      for (const [u, ss, pt] of incoming) {
        if (u === ref.uid || byPage && pt === ref.title) continue;
        const attr = attrNameOf(ss);
        if (attr) {
          add(attrs, `← ${attr}`, { kind: "page", title: pt }, pt);
          continue;
        }
        const g = pages.get(pt) || { count: 0 };
        g.count += 1;
        pages.set(pt, g);
      }
      const linkedFrom = [...pages.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([pt, g]) => ({ relation: "linked from", target: { kind: "page", title: pt }, text: g.count > 1 ? `${pt} (${g.count})` : pt }));
      return [...attrs, ...links, ...linkedFrom].slice(0, limit);
    }
  };
  return host;
}

// src/model/board.js
var AUTO_GAP = 40;
var AUTO_OFFSET = 48;
var AUTO_ROWS = 4;
var TITLE_BAND = 32;
var BORDER_BAND = 8;
var isNum2 = (v) => typeof v === "number" && Number.isFinite(v);
function sortedChildren(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function rectOf(o) {
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function contains(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function centerOf(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function autoPlace(siblings) {
  const placed = siblings.filter((s) => s.hasLayout);
  const loose = siblings.filter((s) => !s.hasLayout);
  if (!loose.length) return;
  let startX = 0;
  let startY = 0;
  if (placed.length) {
    const u = placed.map(rectOf).reduce(unionRect);
    startX = u.x + u.w + AUTO_OFFSET;
    startY = u.y;
  }
  let colX = startX;
  let colW = 0;
  let y = startY;
  loose.forEach((item, i) => {
    const row = i % AUTO_ROWS;
    if (i > 0 && row === 0) {
      colX += colW + AUTO_GAP;
      colW = 0;
      y = startY;
    }
    item.x = colX;
    item.y = y;
    y += item.h + AUTO_GAP;
    colW = Math.max(colW, item.w);
  });
}
function buildBoard(pulled, { defaults } = {}) {
  if (!pulled || typeof pulled !== "object") return null;
  const uid = pulled[":block/uid"];
  const string = pulled[":block/string"] ?? "";
  const plexus = readPlexus(pulled[":block/props"]);
  const sizes = { ...DEFAULT_SIZES, card: defaults?.card ?? DEFAULT_SIZES.card };
  const items = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const roots = [];
  const preorder = [];
  let containerUid = null;
  let containerIndex = -1;
  const boardKids = sortedChildren(pulled);
  boardKids.forEach((child, index) => {
    if (containerUid === null && readPlexus(child[":block/props"])?.type === "edges") {
      containerUid = child[":block/uid"];
      containerIndex = index;
    }
  });
  const walk = (children, parentUid, depth) => {
    const siblings = [];
    for (const child of children) {
      const cuid = child[":block/uid"];
      if (cuid === containerUid) continue;
      const cplexus = readPlexus(child[":block/props"]);
      const cstring = child[":block/string"] ?? "";
      const heading = child[":block/heading"] || 0;
      const kids = sortedChildren(child);
      const layout = normalizeItemLayout(cplexus);
      let type = layout.type;
      if (!cplexus && heading > 0 && kids.length) type = "section";
      const cls = classifyString(cstring);
      const kind = type === "section" ? "section" : type === "text" ? "text" : cls.kind;
      const size = sizes[type];
      const hasLayout = isNum2(layout.x) && isNum2(layout.y);
      let title;
      if (kind === "page") title = cls.title;
      else if (kind === "board") title = parseBoardTitle(cstring) || "Untitled board";
      else title = firstLine(cstring);
      let target;
      if (kind === "page") target = { kind: "page", title: cls.title };
      else if (kind === "block") target = { kind: "block", uid: cls.refUid };
      else target = { kind: "self", uid: cuid };
      const item = {
        uid: cuid,
        type,
        kind,
        string: cstring,
        heading,
        parentUid,
        order: child[":block/order"] ?? siblings.length,
        depth,
        x: hasLayout ? layout.x : 0,
        y: hasLayout ? layout.y : 0,
        w: layout.w ?? size.w,
        h: layout.h ?? size.h,
        hasLayout,
        color: layout.color,
        collapsed: layout.collapsed === true,
        fontSize: layout.fontSize,
        title,
        target,
        enhanced: kind === "board" && cplexus?.v === 2,
        members: [],
        content: type === "section" ? [] : kids
      };
      items.set(cuid, item);
      preorder.push(cuid);
      siblings.push(item);
      if (type === "section") {
        item.members = walk(kids, cuid, depth + 1).map((m) => m.uid);
      }
    }
    autoPlace(siblings);
    return siblings;
  };
  for (const item of walk(boardKids, uid, 0)) roots.push(item.uid);
  const sections = preorder.filter((u) => items.get(u).type === "section");
  const rest = preorder.filter((u) => items.get(u).type !== "section");
  sections.sort((a, b) => items.get(a).depth - items.get(b).depth);
  const order = [...sections, ...rest];
  if (containerUid !== null) {
    const container = boardKids[containerIndex];
    for (const e of sortedChildren(container)) {
      const eplexus = readPlexus(e[":block/props"]);
      if (eplexus?.type !== "edge") continue;
      const euid = e[":block/uid"];
      const estring = e[":block/string"] ?? "";
      const n = normalizeEdge(eplexus);
      const a = items.get(n.from);
      const b = items.get(n.to);
      edges.set(euid, {
        uid: euid,
        string: estring,
        ...n,
        label: parseEdgeLabel(estring, a ? semanticRef(a) : "", b ? semanticRef(b) : ""),
        valid: Boolean(a && b)
      });
    }
  }
  return {
    uid,
    string,
    title: parseBoardTitle(string),
    plexus,
    enhanced: plexus?.v === 2,
    items,
    roots,
    order,
    containerUid,
    containerIndex,
    childCount: boardKids.length,
    edges
  };
}
function worldRects(board) {
  const rects = /* @__PURE__ */ new Map();
  for (const item of board.items.values()) {
    const p = item.parentUid === board.uid ? null : rects.get(item.parentUid);
    rects.set(item.uid, { x: item.x + (p?.x ?? 0), y: item.y + (p?.y ?? 0), w: item.w, h: item.h });
  }
  return rects;
}
function worldRect(board, uid, rects) {
  if (rects) return rects.get(uid) ?? null;
  const item = board.items.get(uid);
  if (!item) return null;
  let x = item.x;
  let y = item.y;
  let parent = board.items.get(item.parentUid);
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = board.items.get(parent.parentUid);
  }
  return { x, y, w: item.w, h: item.h };
}
function descendantsOf(board, uid) {
  const out = /* @__PURE__ */ new Set();
  const stack = [...board.items.get(uid)?.members ?? []];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...board.items.get(u)?.members ?? []);
  }
  return out;
}
function hasAncestorIn(board, uid, set) {
  let p = board.items.get(uid)?.parentUid;
  while (p && p !== board.uid) {
    if (set.has(p)) return true;
    p = board.items.get(p)?.parentUid;
  }
  return false;
}
function topLevelOf(board, uids) {
  const list = [...uids].filter((u) => board.items.has(u));
  const set = new Set(list);
  return list.filter((u) => !hasAncestorIn(board, u, set));
}
function containerAt(board, point, { exclude = /* @__PURE__ */ new Set(), rects } = {}) {
  const r = rects ?? worldRects(board);
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  let best = null;
  for (const uid of board.order) {
    const item = board.items.get(uid);
    if (item.type !== "section" || ex.has(uid) || hasAncestorIn(board, uid, ex)) continue;
    if (!contains(r.get(uid), point)) continue;
    if (!best || item.depth >= best.depth) best = item;
  }
  return best ? best.uid : board.uid;
}
function toRelative(board, containerUid, worldPoint, rects) {
  if (containerUid === board.uid) return { x: worldPoint.x, y: worldPoint.y };
  const c = worldRect(board, containerUid, rects);
  return { x: worldPoint.x - c.x, y: worldPoint.y - c.y };
}
function hitTest(board, point, rects, { sectionInterior = false, exclude = null } = {}) {
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
    if (item.type === "section" || exclude?.has(item.uid)) continue;
    if (contains(rects.get(item.uid), point)) return { uid: item.uid, part: "body" };
  }
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
    if (item.type !== "section" || exclude?.has(item.uid)) continue;
    const r = rects.get(item.uid);
    if (!contains(r, point)) continue;
    if (point.y - r.y <= TITLE_BAND) return { uid: item.uid, part: "title" };
    const edge = Math.min(point.x - r.x, r.x + r.w - point.x, point.y - r.y, r.y + r.h - point.y);
    if (edge <= BORDER_BAND) return { uid: item.uid, part: "border" };
    if (sectionInterior) return { uid: item.uid, part: "interior" };
  }
  return null;
}
function boundsOf(rectList) {
  const list = [...rectList];
  return list.length ? list.reduce(unionRect) : null;
}
function boardPreview(item, { max = 60 } = {}) {
  const child = buildBoard({
    ":block/uid": item?.uid,
    ":block/string": item?.string ?? "",
    ":block/children": item?.content ?? []
  });
  if (!child) return { count: 0, aspect: 1.5, rects: [], bounds: null };
  const world = worldRects(child);
  const bounds = boundsOf([...world.values()]);
  if (!bounds) return { count: 0, aspect: 1.5, rects: [], bounds: null };
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;
  const rects = [];
  for (const uid of child.order) {
    if (rects.length >= max) break;
    const r = world.get(uid);
    const it = child.items.get(uid);
    rects.push({ x: (r.x - bounds.x) / bw, y: (r.y - bounds.y) / bh, w: r.w / bw, h: r.h / bh, type: it.type, color: it.color });
  }
  return { count: child.items.size, aspect: Math.min(4, Math.max(0.25, bw / bh)), rects, bounds };
}
function itemsInRect(board, rect, rects, { mode = "contain" } = {}) {
  const test = mode === "intersect" ? intersects : (r, a) => containsRect(r, a);
  const hits = [];
  for (const uid of board.order) {
    const r = rects.get(uid);
    if (r && test(rect, r)) hits.push(uid);
  }
  return topLevelOf(board, hits);
}
function membershipPlan(board, movedUids, rects) {
  const moved = topLevelOf(board, movedUids);
  const exclude = new Set(moved);
  const plan = [];
  for (const uid of moved) {
    const item = board.items.get(uid);
    const r = rects.get(uid);
    const toParent = containerAt(board, centerOf(r), { exclude, rects });
    if (toParent === item.parentUid) continue;
    const rel = toRelative(board, toParent, { x: r.x, y: r.y }, rects);
    plan.push({ uid, fromParent: item.parentUid, toParent, x: rel.x, y: rel.y });
  }
  return plan;
}
function sectionAdoptPlan(board, sectionUid, rects) {
  const section = board.items.get(sectionUid);
  if (!section) return [];
  const sr = rects.get(sectionUid);
  const parentUid = section.parentUid;
  const siblings = parentUid === board.uid ? board.roots : board.items.get(parentUid).members;
  const plan = [];
  for (const uid of siblings) {
    if (uid === sectionUid) continue;
    const r = rects.get(uid);
    if (!contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, sectionUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: sectionUid, x: rel.x, y: rel.y });
  }
  for (const uid of section.members) {
    const r = rects.get(uid);
    if (contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, parentUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: parentUid, x: rel.x, y: rel.y });
  }
  return plan;
}
function edgesTouching(board, uidSet) {
  const full = new Set(uidSet);
  for (const u of uidSet) for (const d of descendantsOf(board, u)) full.add(d);
  const out = /* @__PURE__ */ new Set();
  for (const e of board.edges.values()) if (full.has(e.from) || full.has(e.to)) out.add(e.uid);
  return out;
}
function findEdge(board, from, to) {
  for (const e of board.edges.values()) if (e.from === from && e.to === to) return e;
  return null;
}
function diffBoards(prev, next) {
  if (!prev || !next) {
    const dirty2 = /* @__PURE__ */ new Set();
    if (next) {
      for (const u of next.items.keys()) dirty2.add(u);
      for (const u of next.edges.keys()) dirty2.add(u);
    }
    return { structural: true, dirty: dirty2 };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let structural = prev.containerUid !== next.containerUid || prev.items.size !== next.items.size || prev.edges.size !== next.edges.size || !same(prev.roots, next.roots) || !same(prev.order, next.order);
  const dirty = /* @__PURE__ */ new Set();
  if (prev.string !== next.string || !same(prev.plexus, next.plexus)) dirty.add(next.uid);
  for (const [uid, item] of next.items) {
    const old = prev.items.get(uid);
    if (!old) {
      structural = true;
      dirty.add(uid);
      continue;
    }
    if (old.parentUid !== item.parentUid || !same(old.members, item.members)) structural = true;
    if (!same(old, item)) dirty.add(uid);
  }
  for (const [uid, edge] of next.edges) {
    const old = prev.edges.get(uid);
    if (!old) {
      structural = true;
      dirty.add(uid);
      continue;
    }
    if (!same(old, edge)) dirty.add(uid);
  }
  return { structural, dirty };
}

// src/model/links.js
var MAX_SOURCES = 20;
function linksQuery() {
  return `[:find ?a ?b ?su ?ss
 :in $ ?board [?a ...] [?b ...]
 :where
 [?src :block/refs ?b]
 (or [?src :block/page ?a] [?src :block/parents ?a] [(= ?src ?a)])
 [(not= ?a ?b)]
 (not [?src :block/parents ?board])
 [(not= ?src ?board)]
 [?src :block/uid ?su]
 [?src :block/string ?ss]]`;
}
function isBareAttr(s) {
  return typeof s === "string" && /^\s*[^:\n]{1,60}::\s*$/.test(s);
}
function reduceLinks(rows, { eidToItems, parentStrings = /* @__PURE__ */ new Map() } = {}) {
  const byKey = /* @__PURE__ */ new Map();
  for (const [aEid, bEid, su, ss] of rows) {
    const froms = eidToItems.get(aEid) || [];
    const tos = eidToItems.get(bEid) || [];
    if (!froms.length || !tos.length) continue;
    let label = attrNameOf(ss);
    if (label == null) {
      const ps = parentStrings.get(su);
      if (isBareAttr(ps)) label = attrNameOf(ps);
    }
    const isAttr = label != null;
    if (!isAttr) label = "mentions";
    for (const from of froms) {
      for (const to of tos) {
        if (from === to) continue;
        const key = `${from}->${to}`;
        let link = byKey.get(key);
        if (!link) {
          link = { key, from, to, kind: "ref", labels: [], sources: [], color: "gray" };
          byKey.set(key, link);
        }
        if (isAttr) link.kind = "attr";
        if (!link.labels.includes(label)) link.labels.push(label);
        if (link.sources.length < MAX_SOURCES && !link.sources.some((s) => s.uid === su)) {
          link.sources.push({ uid: su, string: ss });
        }
      }
    }
  }
  const out = [];
  for (const link of byKey.values()) {
    link.labels = [
      ...link.labels.filter((l) => l !== "mentions"),
      ...link.labels.filter((l) => l === "mentions")
    ];
    link.color = colorForLabel(link.labels[0]);
    out.push(link);
  }
  return out;
}
function filterLinks(links, mode) {
  if (mode === "off") return [];
  if (mode === "attributes") return links.filter((l) => l.kind === "attr");
  return links;
}
function coveredBy(links, board) {
  const pairs = /* @__PURE__ */ new Map();
  for (const [uid, e] of board.edges) {
    for (const k of [`${e.from}->${e.to}`, `${e.to}->${e.from}`]) {
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(uid);
    }
  }
  const visible = [];
  const coveredEdges = /* @__PURE__ */ new Set();
  for (const l of links) {
    const hit = pairs.get(`${l.from}->${l.to}`);
    if (hit) hit.forEach((u) => coveredEdges.add(u));
    else visible.push(l);
  }
  return { visible, coveredEdges };
}

// src/host/migrate.js
var METADATA_PAGE = "plexus-diagram/metadata";
function sortedKids2(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
var str = (n) => String(n?.[":block/string"] ?? "").trim();
function pair(text) {
  const p = String(text).split(",").map((s) => Number(s.trim()));
  return p.length >= 2 && p.slice(0, 2).every(Number.isFinite) ? { a: p[0], b: p[1], c: p[2] } : null;
}
function prop(line, name) {
  return line.startsWith(`${name}::`) ? line.slice(name.length + 2).trim() : null;
}
var ROUTES2 = { bezier: "curve", curve: "curve", straight: "straight", step: "elbow", smoothstep: "elbow", elbow: "elbow" };
var DIRS2 = { oneWay: "one", twoWay: "two", none: "none" };
function readV06Entry(host, boardUid) {
  const page = host.pullPage(METADATA_PAGE);
  if (!page) return null;
  const root = sortedKids2(page).find((c) => str(c) === "enhanced::");
  if (!root) return null;
  const entryNode = sortedKids2(root).find((c) => str(c) === boardUid);
  if (!entryNode) return null;
  const out = { nodes: /* @__PURE__ */ new Map(), sections: [], edges: [], viewport: null, entryUid: entryNode[":block/uid"], migrated: false };
  for (const child of sortedKids2(entryNode)) {
    const line = str(child);
    const vp = prop(line, "viewport");
    if (vp !== null) {
      const p = pair(vp);
      if (p && Number.isFinite(p.c)) out.viewport = { x: p.a, y: p.b, zoom: p.c };
      continue;
    }
    if (line.startsWith("migrated::")) {
      out.migrated = true;
      continue;
    }
    if (line.startsWith("node ")) {
      const uid = line.slice(5).trim();
      const node = { x: void 0, y: void 0, w: void 0, h: void 0, color: void 0 };
      for (const k of sortedKids2(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const color = prop(l, "color");
        if (pos !== null) {
          const p = pair(pos);
          if (p) {
            node.x = p.a;
            node.y = p.b;
          }
        }
        if (size !== null) {
          const p = pair(size);
          if (p) {
            node.w = p.a;
            node.h = p.b;
          }
        }
        if (color !== null && PALETTE.includes(color)) node.color = color;
      }
      out.nodes.set(uid, node);
      continue;
    }
    if (line.startsWith("edge ")) {
      const m = /^(.+)->(.+)$/.exec(line.slice(5).trim());
      if (!m) continue;
      const edge = { from: m[1].trim(), to: m[2].trim(), route: "curve", label: "", fromSide: "auto", toSide: "auto", dir: "one", color: void 0 };
      for (const k of sortedKids2(child)) {
        const l = str(k);
        const kind = prop(l, "kind");
        const label = prop(l, "label");
        const from = prop(l, "from");
        const to = prop(l, "to");
        const dir = prop(l, "direction");
        const color = prop(l, "color");
        if (kind !== null) edge.route = ROUTES2[kind] ?? "curve";
        if (label !== null) edge.label = label;
        if (from !== null && SIDES.includes(from)) edge.fromSide = from;
        if (to !== null && SIDES.includes(to)) edge.toSide = to;
        if (dir !== null && DIRS2[dir]) edge.dir = DIRS2[dir];
        if (color !== null && PALETTE.includes(color)) edge.color = color;
      }
      out.edges.push(edge);
      continue;
    }
    if (line.startsWith("section ")) {
      const sec = { id: line.slice(8).trim(), x: void 0, y: void 0, w: void 0, h: void 0, title: "", color: void 0 };
      for (const k of sortedKids2(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const title = prop(l, "title");
        const color = prop(l, "color");
        if (pos !== null) {
          const p = pair(pos);
          if (p) {
            sec.x = p.a;
            sec.y = p.b;
          }
        }
        if (size !== null) {
          const p = pair(size);
          if (p) {
            sec.w = p.a;
            sec.h = p.b;
          }
        }
        if (title !== null) sec.title = title;
        if (color !== null && PALETTE.includes(color)) sec.color = color;
      }
      out.sections.push(sec);
    }
  }
  return out;
}
function parseData(raw) {
  if (typeof raw === "string") {
    try {
      return plainKeys(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? plainKeys(raw) : {};
}
var finite = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function readNative(host, boardUid) {
  const pulled = host.pullNative(boardUid);
  const rawNodes = Array.isArray(pulled?.[":diagram/nodes"]) ? pulled[":diagram/nodes"] : [];
  const rawEdges = Array.isArray(pulled?.[":diagram/edges"]) ? pulled[":diagram/edges"] : [];
  const keyById = /* @__PURE__ */ new Map();
  const nodes = rawNodes.map((n) => {
    const id = n[":db/id"];
    const blockUid = n[":diagram.node/block"]?.[":block/uid"] ?? null;
    const key = blockUid ?? `n${id}`;
    keyById.set(id, key);
    const data = parseData(n[":diagram.node/data"]);
    const abs = data.positionAbsolute && finite(data.positionAbsolute.x) !== void 0 ? data.positionAbsolute : null;
    const pos = abs ?? data.position ?? {};
    return {
      key,
      blockUid,
      x: finite(pos.x) ?? 0,
      y: finite(pos.y) ?? 0,
      w: finite(data.width) ?? finite(data.measured?.width),
      h: finite(data.height) ?? finite(data.measured?.height),
      absolute: Boolean(abs),
      parentId: n[":diagram.node/parent-node"]?.[":db/id"],
      type: data.type === "group" ? "group" : "node",
      title: n[":diagram.node/block"]?.[":block/string"] ?? ""
    };
  });
  for (const n of nodes) {
    n.parentNode = n.parentId != null ? keyById.get(n.parentId) : void 0;
    delete n.parentId;
  }
  const edges = [];
  for (const e of rawEdges) {
    const from = keyById.get(e[":diagram.edge/source"]?.[":db/id"]);
    const to = keyById.get(e[":diagram.edge/target"]?.[":db/id"]);
    if (!from || !to) continue;
    const data = parseData(e[":diagram.edge/data"]);
    edges.push({ from, to, label: typeof data.label === "string" ? data.label : "" });
  }
  return { nodes, edges };
}
var round12 = (n) => Math.round(n * 10) / 10;
var centerOf2 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
var inside = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
function defaultGen() {
  let n = 0;
  return () => `imp${String(++n).padStart(6, "0")}`;
}
function refOf(board, uid, sectionUids) {
  const item = board.items.get(uid);
  if (item && !sectionUids.has(uid)) return semanticRef(item);
  return `((${uid}))`;
}
function edgePlan(board, sectionUids, from, to, label, extra = {}) {
  const dir = extra.dir ?? "one";
  return {
    from,
    to,
    label,
    string: edgeString({ srcRef: refOf(board, from, sectionUids), dstRef: refOf(board, to, sectionUids), dir, label }),
    props: serializeEdge({ from, to, dir, ...extra, type: void 0 })
  };
}
function planV06(board, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: source.viewport ?? null, markMigratedUid: source.entryUid ?? null };
  const secs = source.sections.map((s) => {
    const uid = gen();
    const w = s.w ?? DEFAULT_SIZES.section.w;
    const h = s.h ?? DEFAULT_SIZES.section.h;
    const abs = { x: s.x ?? 0, y: s.y ?? 0, w, h };
    return {
      uid,
      abs,
      entry: { uid, title: s.title || "Section", layout: { type: "section", x: abs.x, y: abs.y, w, h, color: s.color }, members: [], parent: null }
    };
  });
  plan.sections = secs.map((s) => s.entry);
  const sectionUids = new Set(plan.sections.map((s) => s.uid));
  for (const [uid, node] of source.nodes) {
    const item = board.items.get(uid);
    if (!item || item.type === "section") continue;
    const abs = {
      x: node.x ?? item.x,
      y: node.y ?? item.y,
      w: node.w ?? item.w,
      h: node.h ?? item.h
    };
    const c = centerOf2(abs);
    let best = null;
    for (const s of secs) {
      if (!inside(s.abs, c)) continue;
      if (!best || s.abs.w * s.abs.h < best.abs.w * best.abs.h) best = s;
    }
    const layout = { type: item.type, w: abs.w, h: abs.h, color: node.color };
    if (best) {
      best.entry.members.push(uid);
      plan.memberLayouts.push({ uid, layout: { ...layout, x: round12(abs.x - best.abs.x), y: round12(abs.y - best.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid, layout: { ...layout, x: abs.x, y: abs.y } });
    }
  }
  for (const e of source.edges) {
    if (!board.items.has(e.from) || !board.items.has(e.to) || e.from === e.to) continue;
    plan.edges.push(edgePlan(board, sectionUids, e.from, e.to, e.label ?? "", {
      fromSide: e.fromSide,
      toSide: e.toSide,
      dir: e.dir,
      route: e.route,
      color: e.color
    }));
  }
  return plan;
}
function planNative(board, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  const nodes = source.nodes;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const widths = nodes.filter((n) => n.type !== "group").map((n) => n.w).filter((w) => w > 0).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length / 2)] : 165;
  const scale = Math.max(1, 240 / typical);
  const absCache = /* @__PURE__ */ new Map();
  const absOf = (n, seen = /* @__PURE__ */ new Set()) => {
    if (absCache.has(n.key)) return absCache.get(n.key);
    let p = { x: n.x, y: n.y };
    if (!n.absolute && n.parentNode && !seen.has(n.key)) {
      const parent = byKey.get(n.parentNode);
      if (parent) {
        seen.add(n.key);
        const pa = absOf(parent, seen);
        p = { x: pa.x + n.x, y: pa.y + n.y };
      }
    }
    absCache.set(n.key, p);
    return p;
  };
  const sectionOf = /* @__PURE__ */ new Map();
  const groups = nodes.filter((n) => n.type === "group");
  for (const g of groups) {
    const existing = g.blockUid && board.items.has(g.blockUid);
    const uid = existing ? g.blockUid : gen();
    const a = absOf(g);
    const abs = {
      x: a.x * scale,
      y: a.y * scale,
      w: (g.w ?? DEFAULT_SIZES.section.w / scale) * scale,
      h: (g.h ?? DEFAULT_SIZES.section.h / scale) * scale
    };
    sectionOf.set(g.key, {
      uid,
      abs,
      entry: { uid, title: g.title || board.items.get(uid)?.title || "Section", layout: null, members: [], parent: null, existing: Boolean(existing) }
    });
  }
  for (const g of groups) {
    const s = sectionOf.get(g.key);
    const parent = g.parentNode ? sectionOf.get(g.parentNode) : null;
    const base = parent ? { x: parent.abs.x, y: parent.abs.y } : { x: 0, y: 0 };
    s.entry.parent = parent ? parent.uid : null;
    s.entry.layout = { type: "section", x: round12(s.abs.x - base.x), y: round12(s.abs.y - base.y), w: round12(s.abs.w), h: round12(s.abs.h) };
    plan.sections.push(s.entry);
  }
  const sectionUids = new Set(plan.sections.map((s) => s.uid));
  const uidOfKey = /* @__PURE__ */ new Map();
  for (const g of groups) uidOfKey.set(g.key, sectionOf.get(g.key).uid);
  for (const n of nodes) {
    if (n.type === "group") continue;
    const item = n.blockUid ? board.items.get(n.blockUid) : null;
    if (!item || item.type === "section") continue;
    uidOfKey.set(n.key, item.uid);
    const a = absOf(n);
    const abs = { x: a.x * scale, y: a.y * scale };
    const layout = {
      type: item.type,
      w: Math.max(MIN_SIZES.card.w, Math.round((n.w ?? item.w / scale) * scale)),
      h: Math.max(MIN_SIZES.card.h, Math.round((n.h ?? item.h / scale) * scale))
    };
    const sec = n.parentNode ? sectionOf.get(n.parentNode) : null;
    if (sec) {
      sec.entry.members.push(item.uid);
      plan.memberLayouts.push({ uid: item.uid, layout: { ...layout, x: round12(abs.x - sec.abs.x), y: round12(abs.y - sec.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid: item.uid, layout: { ...layout, x: round12(abs.x), y: round12(abs.y) } });
    }
  }
  for (const e of source.edges) {
    const from = uidOfKey.get(e.from);
    const to = uidOfKey.get(e.to);
    if (!from || !to || from === to) continue;
    plan.edges.push(edgePlan(board, sectionUids, from, to, e.label ?? ""));
  }
  return plan;
}
function planImport(board, source, { gen = defaultGen() } = {}) {
  if (!source) return { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  return source.nodes instanceof Map ? planV06(board, source, gen) : planNative(board, source, gen);
}
async function executeImport(plan, host, board) {
  const counts = { sections: 0, members: 0, items: 0, edges: 0 };
  const layoutProps = (layout) => serializeItemLayout(layout);
  const keepMarker = (uid, layout) => {
    const cur = readPlexus(host.pullProps?.(uid));
    return layoutProps(cur ? { ...layout, v: cur.v, bg: cur.bg } : layout);
  };
  for (const s of plan.sections) {
    if (s.existing) await host.updateProps(s.uid, keepMarker(s.uid, { ...s.layout, type: "section" }));
    else {
      await host.createBlock({
        parentUid: board.uid,
        order: "last",
        uid: s.uid,
        string: s.title,
        props: { plexus: layoutProps({ ...s.layout, type: "section" }) }
      });
    }
    counts.sections++;
  }
  for (const s of plan.sections) {
    if (s.parent) await host.moveBlock(s.uid, s.parent, "last");
  }
  const memberLayouts = new Map(plan.memberLayouts.map((m) => [m.uid, m.layout]));
  for (const s of plan.sections) {
    for (const uid of s.members) {
      await host.moveBlock(uid, s.uid, "last");
      const layout = memberLayouts.get(uid);
      if (layout) await host.updateProps(uid, keepMarker(uid, layout));
      counts.members++;
    }
  }
  for (const { uid, layout } of plan.itemLayouts) {
    await host.updateProps(uid, keepMarker(uid, layout));
    counts.items++;
  }
  if (plan.edges.length) {
    let containerUid = board.containerUid;
    if (!containerUid) {
      containerUid = await host.createBlock({
        parentUid: board.uid,
        order: "last",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        open: false
      });
    }
    for (const e of plan.edges) {
      await host.createBlock({ parentUid: containerUid, order: "last", string: e.string, props: { plexus: e.props } });
      counts.edges++;
    }
  }
  if (plan.markMigratedUid) {
    await host.createBlock({ parentUid: plan.markMigratedUid, order: "last", string: "migrated:: 2" });
  }
  if (plan.viewport) {
    host.viewports?.set(board.uid, plan.viewport);
    host.viewports?.flushAll?.();
  }
  await host.updateProps(board.uid, withBoardMarker(board.plexus, true));
  return counts;
}

// src/session.js
var UID = ":block/uid";
var STR = ":block/string";
var ORD = ":block/order";
var KIDS = ":block/children";
var PROPS = ":block/props";
var OPEN = ":block/open";
var LINK_MODES = ["off", "attributes", "all"];
var ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize"];
var EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color"];
var MAX_PARENT_STRINGS = 200;
var registry = /* @__PURE__ */ new Map();
var clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
var round13 = (n) => Math.round(n * 10) / 10;
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== void 0) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
var stable = (v) => v == null ? "null" : JSON.stringify(sortKeys(v));
function kidsOf(node) {
  const kids = Array.isArray(node?.[KIDS]) ? node[KIDS] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[ORD] ?? a.i) - (b.c[ORD] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function indexTree(root) {
  const map = /* @__PURE__ */ new Map();
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
  kids.forEach((k, i) => {
    k[ORD] = i;
  });
  parentNode[KIDS] = kids;
}
function unknownKeys(plexus, known) {
  const out = {};
  for (const [k, v] of Object.entries(plexus ?? {})) if (!known.includes(k)) out[k] = v;
  return out;
}
function createSession(uid, { host, settings = null, raf: raf2, now: now2 = Date.now, idle, linkDelay = 1500, graceMs = 800 } = {}) {
  const schedule = raf2 ?? ((fn) => {
    if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(fn);
    const t = setTimeout(fn, 0);
    t.unref?.();
    return t;
  });
  const runIdle = idle ?? ((fn) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(fn, { timeout: 2e3 });
    else fn();
  });
  const listeners2 = /* @__PURE__ */ new Map();
  const emit2 = (name, payload) => {
    for (const fn of [...listeners2.get(name) ?? []]) {
      try {
        fn(payload);
      } catch (err) {
        console.error("[plexus session]", err);
      }
    }
  };
  let busy = false;
  const queue = createWriteQueue({ onBusy: (b) => {
    busy = b;
    emit2("busy", b);
  } });
  const ledger = createEchoLedger({ graceMs, now: now2 });
  let destroyed = false;
  let raw = clone(host.pullBoard(uid));
  let board = null;
  let rects = /* @__PURE__ */ new Map();
  let emitted = null;
  let rix = null;
  const ix = () => rix ?? (rix = indexTree(raw));
  const rebuild = () => {
    rix = null;
    board = raw ? buildBoard(raw) : null;
    rects = board ? worldRects(board) : /* @__PURE__ */ new Map();
  };
  rebuild();
  emitted = board;
  let allLinks = [];
  let visibleLinks = [];
  let covered = /* @__PURE__ */ new Set();
  let linkFingerprint = "";
  const initialMode = typeof settings?.get === "function" ? settings.get("graph-links") : settings?.["graph-links"];
  let linkMode = LINK_MODES.includes(initialMode) ? initialMode : "all";
  const collapseOutline = () => (typeof settings?.get === "function" ? settings.get("collapse-outline") : settings?.["collapse-outline"]) !== false;
  const rawNode = (id) => id === uid ? raw : ix().get(id)?.node ?? null;
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
  const rawDelete = (id) => {
    detach(ix(), id);
    rix = null;
  };
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
    if (diff.structural || diff.dirty.size) emit2("change", diff);
    recomputeLinks(false);
    if (diff.structural) refreshLinks();
  };
  let gone = false;
  const markGone = () => {
    if (gone || destroyed) return;
    gone = true;
    emit2("gone", { uid });
  };
  const repull = () => {
    if (destroyed) return;
    const fresh = host.pullBoard(uid);
    if (!fresh) {
      markGone();
      return;
    }
    raw = clone(fresh);
    publish();
  };
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
          target[KIDS] = [...target[KIDS] ?? [], node];
          inc.set(id, { node, parent: target });
        } else {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          detach(inc, id);
          theirs.node[ORD] = mine.node[ORD];
          target[KIDS] = [...target[KIDS] ?? [], theirs.node];
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
  const unwatch = raw ? host.watchBoard(uid, (after) => {
    if (destroyed) return;
    if (!after || !after[UID]) {
      if (!host.pullBoard(uid)) markGone();
      return;
    }
    latest = after;
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  }) : () => {
  };
  const fieldsOf = (op) => {
    if (op.op === "create") {
      const out = [["parent", op.parent]];
      if (op.props?.plexus !== void 0) out.push(["props", stable(op.props.plexus)]);
      return out;
    }
    if (op.op === "move") return [["parent", op.parent]];
    if (op.op === "delete") return [["parent", ""]];
    if (op.op === "props") return [["props", stable(op.plexus)]];
    if (op.op === "string") return [["string", op.string]];
    return [];
  };
  const settleOp = (op) => {
    for (const [f] of fieldsOf(op)) ledger.settle(op.uid, f);
  };
  async function runOp(op) {
    switch (op.op) {
      case "create":
        await host.createBlock({ parentUid: op.parent, order: op.order, uid: op.uid, string: op.string, props: op.props, open: op.open });
        break;
      case "move":
        await host.moveBlock(op.uid, op.parent, op.order);
        break;
      case "delete":
        await host.deleteBlock(op.uid);
        break;
      case "props":
        await host.updateProps(op.uid, op.plexus);
        break;
      case "string":
        await host.updateString(op.uid, op.string);
        break;
      default:
        break;
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
    const creates = /* @__PURE__ */ new Map();
    const props = /* @__PURE__ */ new Map();
    const strings = /* @__PURE__ */ new Map();
    for (const op of ops) {
      if (op.op === "create") {
        out.push(op);
        creates.set(op.uid, op);
        continue;
      }
      if (op.op === "props") {
        const c = creates.get(op.uid);
        if (c) {
          c.props = mergePropsForWrite(c.props, op.plexus);
          continue;
        }
        const prev = props.get(op.uid);
        if (prev) {
          prev.plexus = op.plexus;
          continue;
        }
        const next = { ...op };
        props.set(op.uid, next);
        out.push(next);
        continue;
      }
      if (op.op === "string") {
        const c = creates.get(op.uid);
        if (c) {
          c.string = op.string;
          continue;
        }
        const prev = strings.get(op.uid);
        if (prev) {
          prev.string = op.string;
          continue;
        }
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
    emit2("toast", { message: "Couldn't save changes to Roam. Reloaded the board from the graph." });
    repull();
  }
  function commit(ops, result) {
    if (!ops.length) return Promise.resolve(result);
    const list = coalesce(ops);
    for (const op of list) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    return queue.run(() => execute(list)).then(() => result, (err) => {
      handleFailure(err);
      return result;
    });
  }
  function txn(fn) {
    if (!board || destroyed || gone) return Promise.resolve(void 0);
    const ops = [];
    const t = {
      create({ parent, uid: id, string = "", plexus, open, order }) {
        const newUid = id ?? host.generateUid();
        const ord = order ?? insertOrder(parent);
        const node = { [UID]: newUid, [STR]: string, [ORD]: 0, [KIDS]: [] };
        if (plexus) node[PROPS] = { plexus: plainKeys(plexus) };
        if (open !== void 0) node[OPEN] = open;
        rawInsert(parent, node, ord);
        ops.push({ op: "create", uid: newUid, parent, order: ord, string, props: plexus ? { plexus } : void 0, open });
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
      sync: rebuild
    };
    const result = fn(t);
    return commit(ops, result);
  }
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
    h: Math.max(MIN_SIZES[type]?.h ?? 1, h)
  });
  function ensureContainer(t) {
    if (board.containerUid) return board.containerUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "edges");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
  }
  function refOf2(id) {
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  }
  function edgeStringFor(from, to, dir, label) {
    return edgeString({ srcRef: refOf2(from), dstRef: refOf2(to), dir, label });
  }
  function recomputeLinks(force) {
    if (!board) return;
    const filtered = filterLinks(allLinks, linkMode);
    const res = coveredBy(filtered, board);
    const fp = `${linkMode}|${res.visible.map((l) => l.key).join(",")}|${[...res.coveredEdges].sort().join(",")}`;
    const changed = fp !== linkFingerprint;
    visibleLinks = res.visible;
    covered = res.coveredEdges;
    linkFingerprint = fp;
    if (changed || force) emit2("links", { links: visibleLinks, coveredEdges: covered });
  }
  function computeLinks() {
    if (!board) return;
    const boardEid = host.resolveEid({ uid });
    const eidToItems = /* @__PURE__ */ new Map();
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
    if (!eids.length || boardEid == null) {
      allLinks = [];
      return;
    }
    const rows = host.q(linksQuery(), boardEid, eids, eids) || [];
    const parentStrings = /* @__PURE__ */ new Map();
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
      try {
        computeLinks();
        recomputeLinks(false);
      } catch (err) {
        console.error("[plexus session] links", err);
      }
    }
    const done = linkResolve;
    linkPromise = null;
    linkResolve = null;
    done?.();
  }
  function refreshLinks() {
    if (destroyed) return Promise.resolve();
    if (linkMode === "off") return Promise.resolve();
    if (!linkPromise) linkPromise = new Promise((resolve) => {
      linkResolve = resolve;
    });
    if (linkTimer) clearTimeout(linkTimer);
    linkTimer = setTimeout(() => runIdle(runLinks), linkDelay);
    linkTimer.unref?.();
    return linkPromise;
  }
  const session = {
    uid,
    host,
    settings,
    get board() {
      return board;
    },
    get gone() {
      return gone;
    },
    get rects() {
      return rects;
    },
    get links() {
      return visibleLinks;
    },
    get coveredEdges() {
      return covered;
    },
    get busy() {
      return busy;
    },
    get linkMode() {
      return linkMode;
    },
    on(name, fn) {
      if (!listeners2.has(name)) listeners2.set(name, /* @__PURE__ */ new Set());
      listeners2.get(name).add(fn);
      return () => listeners2.get(name)?.delete(fn);
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
      if (!board || !dx && !dy) return Promise.resolve();
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
            x: round13(r.x - parentRect.x),
            y: round13(r.y - parentRect.y),
            w: round13(size.w),
            h: round13(size.h)
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
        if (w !== void 0) layout.w = w;
        if (h !== void 0) layout.h = h;
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
        return makeSection(t, rect, "Section", void 0, top);
      });
    },
    createBoard({ rect, title } = {}) {
      return txn((t) => {
        const d = DEFAULT_BOARD_CARD;
        const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
        const size = clampSize("card", r.w, r.h);
        return makeBoard(t, { x: r.x, y: r.y, w: size.w, h: size.h }, title, void 0);
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
          })
        };
      });
    },
    renameBoard(id, title) {
      return txn((t) => {
        const cur0 = board.items.get(id);
        if (cur0?.kind !== "board" || !cur0.enhanced) return;
        const cur = rawNode(id)?.[STR];
        if (cur === void 0) return;
        const next = setBoardTitle(cur, title);
        if (next !== cur) t.string(id, next);
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
          edgeSet = /* @__PURE__ */ new Set();
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
          if (board.items.has(id)) t.props(id, itemPlexus(id, { color: color ?? void 0 }));
          else if (board.edges.has(id)) t.props(id, edgePlexus(id, { color: color ?? void 0 }));
        }
      });
    },
    setCollapsed(id, value) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
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
        if (cur === void 0 || cur === string) return;
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
        if (rest.dir !== void 0 && rest.dir !== edge.dir || label !== void 0 && label !== edge.label) {
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
        emit2("toast", { message: "Couldn't write the connection to the graph." });
        return { ok: false, reason: "write-failed" };
      }
    },
    async undo() {
      try {
        await queue.run(async () => {
          ledger.clear();
          await host.undo();
        });
        repull();
      } catch (err) {
        handleFailure(err);
      }
    },
    async redo() {
      try {
        await queue.run(async () => {
          ledger.clear();
          await host.redo();
        });
        repull();
      } catch (err) {
        handleFailure(err);
      }
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
      const collapse = collapseOutline() && raw?.[OPEN] !== false;
      let counts = null;
      try {
        counts = await queue.run(async () => {
          ledger.clear();
          const done = await executeImport(plan, host, board);
          if (collapse) await host.setOpen(uid, false);
          return done;
        });
      } catch (err) {
        handleFailure(err);
        return { enhanced: false, reason: "write-failed" };
      }
      repull();
      return { enhanced: true, kind, counts };
    },
    restoreNative() {
      return txn((t) => {
        t.props(uid, withBoardMarker(rawPlexus(uid), false));
      });
    },
    release() {
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unwatch();
      if (linkTimer) clearTimeout(linkTimer);
      linkTimer = null;
      linkResolve?.();
      linkPromise = null;
      linkResolve = null;
      listeners2.clear();
      ledger.clear();
    }
  };
  function makeBoard(t, rect, title, exclude, centerOf3 = rect) {
    const parent = containerAt(board, { x: centerOf3.x + centerOf3.w / 2, y: centerOf3.y + centerOf3.h / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    return t.create({
      parent,
      string: boardString(title),
      plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: rect.w, h: rect.h, v: SCHEMA_VERSION }),
      open: collapseOutline() ? false : void 0
    });
  }
  function moveItemsInto(t, top, boardUid, origin, place, track = {}) {
    const moved = track.moved ?? new Set([...top].flatMap((id) => [id, ...descendantsOf(board, id)]));
    for (const id of top) {
      const r = rects.get(id);
      t.move(id, boardUid, insertOrder(boardUid));
      t.props(id, itemPlexus(id, { x: round13(r.x - origin.x + place.x), y: round13(r.y - origin.y + place.y) }));
    }
    let childContainer = null;
    const childEdges = () => {
      if (childContainer) return childContainer;
      const existing = kidsOf(rawNode(boardUid)).find((k) => readPlexus(k[PROPS])?.type === "edges");
      if (existing) {
        childContainer = existing[UID];
        return childContainer;
      }
      childContainer = t.create({ parent: boardUid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
      if (track.info) track.info.createdContainer = childContainer;
      return childContainer;
    };
    const taken = /* @__PURE__ */ new Set();
    const touched = [...board.edges.values()].filter((e) => moved.has(e.from) || moved.has(e.to));
    const snapshots = /* @__PURE__ */ new Map();
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
      if (from === to || dup && dup.uid !== e.uid || taken.has(key)) {
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
      plexus: serializeItemLayout({ type: "section", x: rel.x, y: rel.y, w: size.w, h: size.h, color })
    });
    for (const id of members) {
      if (id === sectionUid) continue;
      const r = rects.get(id);
      t.move(id, sectionUid, "last");
      t.props(id, itemPlexus(id, { x: round13(r.x - rect.x), y: round13(r.y - rect.y) }));
    }
    return sectionUid;
  }
  if (linkMode !== "off" && board) refreshLinks();
  return session;
}
function acquireSession(boardUid, options = {}) {
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

// src/model/geometry.js
var num = (n) => {
  const r = Math.round(n * 1e3) / 1e3;
  return Object.is(r, -0) ? 0 : r;
};
function screenToWorld(vp, p) {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}
function worldToScreen(vp, p) {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}
function clampZoom(z, min = 0.1, max = 4) {
  return Math.min(max, Math.max(min, z));
}
function zoomAt(vp, screenPoint, factor, { min = 0.1, max = 4 } = {}) {
  const zoom = clampZoom(vp.zoom * factor, min, max);
  const w = screenToWorld(vp, screenPoint);
  return { x: screenPoint.x - w.x * zoom, y: screenPoint.y - w.y * zoom, zoom };
}
function fitViewport(bounds, size, { padding = 64, maxZoom = 1.5, minZoom = 0.1 } = {}) {
  if (!bounds) return { x: size.width / 2, y: size.height / 2, zoom: 1 };
  const availW = size.width - 2 * padding;
  const availH = size.height - 2 * padding;
  let zoom = Math.min(bounds.w > 0 ? availW / bounds.w : Infinity, bounds.h > 0 ? availH / bounds.h : Infinity);
  if (!Number.isFinite(zoom)) zoom = maxZoom;
  zoom = clampZoom(zoom, minZoom, maxZoom);
  const c = center(bounds);
  return { x: size.width / 2 - c.x * zoom, y: size.height / 2 - c.y * zoom, zoom };
}
function visibleWorldRect(vp, size, margin = 0) {
  const mw = size.width * margin;
  const mh = size.height * margin;
  return {
    x: (-vp.x - mw) / vp.zoom,
    y: (-vp.y - mh) / vp.zoom,
    w: (size.width + 2 * mw) / vp.zoom,
    h: (size.height + 2 * mh) / vp.zoom
  };
}
function lodForZoom(zoom) {
  return zoom < 0.45 ? "map" : "detail";
}
function center(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function sidePoint(rect, side) {
  switch (side) {
    case "top":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "left":
      return { x: rect.x, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
}
var SIDES2 = ["top", "right", "bottom", "left"];
function nearestSide(rect, point) {
  let best = "top";
  let bestD = Infinity;
  for (const s of SIDES2) {
    const p = sidePoint(rect, s);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
function autoSides(a, b) {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}
var NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
function edgePath({ a, b, fromSide = "auto", toSide = "auto", route = "curve", offset = 0 }) {
  if (fromSide === "auto" || toSide === "auto") {
    const auto = autoSides(a, b);
    if (fromSide === "auto") fromSide = auto.fromSide;
    if (toSide === "auto") toSide = auto.toSide;
  }
  const start = sidePoint(a, fromSide);
  const end = sidePoint(b, toSide);
  const nf = NORMALS[fromSide];
  const nt = NORMALS[toSide];
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  if (route === "straight") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    return {
      d: `M${num(start.x)} ${num(start.y)}L${num(end.x)} ${num(end.y)}`,
      start,
      end,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      startAngle: angle,
      endAngle: angle,
      fromSide,
      toSide
    };
  }
  if (route === "elbow") {
    const STUB = 24;
    const s1 = { x: start.x + nf.x * STUB, y: start.y + nf.y * STUB };
    const e1 = { x: end.x + nt.x * STUB, y: end.y + nt.y * STUB };
    const fromH = nf.y === 0;
    const toH = nt.y === 0;
    const pts = [start, s1];
    if (fromH && toH) {
      const mx = (s1.x + e1.x) / 2;
      pts.push({ x: mx, y: s1.y }, { x: mx, y: e1.y });
    } else if (!fromH && !toH) {
      const my = (s1.y + e1.y) / 2;
      pts.push({ x: s1.x, y: my }, { x: e1.x, y: my });
    } else if (fromH) {
      pts.push({ x: e1.x, y: s1.y });
    } else {
      pts.push({ x: s1.x, y: e1.y });
    }
    pts.push(e1, end);
    const poly = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
    const lens = [];
    let total = 0;
    for (let i = 1; i < poly.length; i++) {
      const l = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
      lens.push(l);
      total += l;
    }
    let mid2 = { ...start };
    let acc = 0;
    for (let i = 0; i < lens.length; i++) {
      if (acc + lens[i] >= total / 2) {
        const t = lens[i] === 0 ? 0 : (total / 2 - acc) / lens[i];
        mid2 = {
          x: poly[i].x + (poly[i + 1].x - poly[i].x) * t,
          y: poly[i].y + (poly[i + 1].y - poly[i].y) * t
        };
        break;
      }
      acc += lens[i];
    }
    const last = poly[poly.length - 1];
    const prev = poly[poly.length - 2] || start;
    const second = poly[1] || end;
    return {
      d: poly.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(""),
      start,
      end,
      mid: mid2,
      startAngle: Math.atan2(second.y - start.y, second.x - start.x),
      endAngle: Math.atan2(last.y - prev.y, last.x - prev.x),
      fromSide,
      toSide
    };
  }
  const k = Math.max(40, 0.4 * dist);
  let px = 0;
  let py = 0;
  if (offset && dist > 0) {
    px = -(end.y - start.y) / dist * offset;
    py = (end.x - start.x) / dist * offset;
  }
  const c1 = { x: start.x + nf.x * k + px, y: start.y + nf.y * k + py };
  const c2 = { x: end.x + nt.x * k + px, y: end.y + nt.y * k + py };
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8
  };
  return {
    d: `M${num(start.x)} ${num(start.y)}C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)}`,
    start,
    end,
    mid,
    startAngle: Math.atan2(c1.y - start.y, c1.x - start.x),
    endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
    fromSide,
    toSide
  };
}
function arrowHeadPath(point, angle, size) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const bx = point.x - dx * size;
  const by = point.y - dy * size;
  const hw = size * 0.45;
  const p1 = { x: bx - dy * hw, y: by + dx * hw };
  const p2 = { x: bx + dy * hw, y: by - dx * hw };
  return `M${num(point.x)} ${num(point.y)}L${num(p1.x)} ${num(p1.y)}L${num(p2.x)} ${num(p2.y)}Z`;
}
function arrowSize(zoom, weight = 1) {
  return Math.max(8 + 2 * weight, 6 / zoom);
}
function bestSnap(values, targets, threshold) {
  let best = null;
  for (const v of values) {
    for (const t of targets) {
      const diff = t - v;
      if (Math.abs(diff) <= threshold && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
    }
  }
  return best ?? 0;
}
var xs = (r) => [r.x, r.x + r.w / 2, r.x + r.w];
var ys = (r) => [r.y, r.y + r.h / 2, r.y + r.h];
var EPS = 1e-6;
function snapMove(moving, others, threshold) {
  const dx = bestSnap(xs(moving), others.flatMap(xs), threshold);
  const dy = bestSnap(ys(moving), others.flatMap(ys), threshold);
  const m = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h };
  const guides = [];
  for (const o of others) {
    for (const mx of xs(m)) {
      if (xs(o).some((ox) => Math.abs(ox - mx) < EPS)) {
        guides.push({ x1: mx, y1: Math.min(m.y, o.y), x2: mx, y2: Math.max(m.y + m.h, o.y + o.h) });
      }
    }
    for (const my of ys(m)) {
      if (ys(o).some((oy) => Math.abs(oy - my) < EPS)) {
        guides.push({ x1: Math.min(m.x, o.x), y1: my, x2: Math.max(m.x + m.w, o.x + o.w), y2: my });
      }
    }
  }
  return { dx, dy, guides };
}
function alignRects(list, mode) {
  if (!list.length) return [];
  const minX = Math.min(...list.map((r) => r.x));
  const maxX = Math.max(...list.map((r) => r.x + r.w));
  const minY = Math.min(...list.map((r) => r.y));
  const maxY = Math.max(...list.map((r) => r.y + r.h));
  return list.map((r) => {
    let x = r.x;
    let y = r.y;
    if (mode === "left") x = minX;
    else if (mode === "right") x = maxX - r.w;
    else if (mode === "center") x = (minX + maxX) / 2 - r.w / 2;
    else if (mode === "top") y = minY;
    else if (mode === "bottom") y = maxY - r.h;
    else if (mode === "middle") y = (minY + maxY) / 2 - r.h / 2;
    return { uid: r.uid, x, y };
  });
}
function distributeRects(list, axis) {
  const h = axis === "h";
  const pos = h ? "x" : "y";
  const dim = h ? "w" : "h";
  const sorted = [...list].sort((p, q) => p[pos] - q[pos]);
  if (sorted.length < 3) return sorted.map((r) => ({ uid: r.uid, x: r.x, y: r.y }));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[dim] - first[pos];
  const total = sorted.reduce((s, r) => s + r[dim], 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = first[pos];
  return sorted.map((r, i) => {
    const p = i === sorted.length - 1 ? last[pos] : cursor;
    cursor += r[dim] + gap;
    return h ? { uid: r.uid, x: p, y: r.y } : { uid: r.uid, x: r.x, y: p };
  });
}
function gridBackground(vp, style, base = 24) {
  if (style === "plain") return null;
  const size = base * vp.zoom;
  const mod = (v) => (v % size + size) % size;
  return { size, x: mod(vp.x), y: mod(vp.y) };
}

// src/view/interactions.js
var TOOL_KEYS = { v: "select", h: "hand", n: "card", t: "text", g: "section", w: "board", c: "connect" };
var TOOLS = ["select", "hand", "card", "text", "section", "board", "connect"];
var DRAG_THRESHOLD_PX = 4;
var SNAP_PX = 6;
var STICKY_TOOLS = /* @__PURE__ */ new Set(["select", "hand"]);
function normRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
function createInteractions({ actions, settings } = {}) {
  const a = actions || {};
  const call = (name, ...args) => typeof a[name] === "function" ? a[name](...args) : void 0;
  const setting = (key, def) => {
    const v = typeof settings?.get === "function" ? settings.get(key) : settings?.[key];
    return v === void 0 || v === null ? def : v;
  };
  const state = {
    tool: "select",
    locked: false,
    selection: /* @__PURE__ */ new Set(),
    edge: null,
    link: null,
    gesture: null,
    space: false,
    hover: null
  };
  const board = () => call("board");
  const rects = () => call("rects");
  const vp = () => call("viewport") || { x: 0, y: 0, zoom: 1 };
  const zoom = () => vp().zoom || 1;
  const emitSelection = () => {
    call("onSelection", { items: [...state.selection], edge: state.edge, link: state.link });
  };
  const selectItems = (uids) => {
    state.selection = new Set(uids);
    state.edge = null;
    state.link = null;
    emitSelection();
  };
  const selectEdge = (uid) => {
    state.selection = /* @__PURE__ */ new Set();
    state.edge = uid;
    state.link = null;
    emitSelection();
  };
  const selectLink = (key) => {
    state.selection = /* @__PURE__ */ new Set();
    state.edge = null;
    state.link = key;
    emitSelection();
  };
  const clearSelection = () => {
    if (!state.selection.size && !state.edge && !state.link) return false;
    selectItems([]);
    return true;
  };
  const setTool = (tool, lock = false) => {
    if (!TOOLS.includes(tool)) return;
    state.tool = tool;
    state.locked = Boolean(lock) && !STICKY_TOOLS.has(tool);
    call("onTool", state.tool, state.locked);
  };
  const afterToolUse = () => {
    if (!state.locked && !STICKY_TOOLS.has(state.tool)) setTool("select");
  };
  const begin = (g) => {
    state.gesture = { moved: false, ...g };
    call("setGesturing", true);
  };
  const end = () => {
    const moved = Boolean(state.gesture?.moved);
    state.gesture = null;
    call("showMarquee", null);
    call("showGuides", []);
    call("showTempWire", null);
    call("onHover", null);
    call("setGesturing", false, { moved });
  };
  const movingSet = () => {
    const b = board();
    if (!b) return [];
    return topLevelOf(b, state.selection);
  };
  const movingBounds = (uids) => {
    const r = rects();
    return boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
  };
  const otherRects = (uids) => {
    const b = board();
    const r = rects();
    const skip = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(b, u)) skip.add(d);
    const out = [];
    for (const uid of b.items.keys()) if (!skip.has(uid) && r.get(uid)) out.push(r.get(uid));
    return out;
  };
  const editingUid = () => call("editingUid") ?? null;
  const isEditing = () => Boolean(call("isEditing"));
  const beginConnect = (uid, side, world) => {
    begin({ kind: "connect", from: uid, fromSide: side, start: world });
    call("showTempWire", { from: uid, fromSide: side, point: world });
  };
  const onPointerDown = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    if (ev.button === 2) return;
    if (state.gesture) return;
    const editing = editingUid();
    if (editing) {
      if (t.kind === "item" && t.uid === editing && t.part !== "header") return;
      if (!(t.kind === "item" && t.uid === editing)) call("exitEdit");
    }
    const panRequested = ev.button === 1 || state.space || state.tool === "hand";
    if (panRequested) {
      begin({ kind: "pan", start: ev.screen, vp0: { ...vp() } });
      return;
    }
    if (ev.button !== 0) return;
    const b = board();
    const r = rects();
    switch (t.kind) {
      case "port":
        if (t.uid) beginConnect(t.uid, t.side || "right", ev.world);
        return;
      case "grip": {
        if (!t.uid || !r?.get(t.uid)) return;
        if (!state.selection.has(t.uid)) selectItems([t.uid]);
        begin({ kind: "resize", uid: t.uid, part: t.part || "corner", start: ev.world, rect0: { ...r.get(t.uid) } });
        return;
      }
      case "edge":
      case "label":
        if (t.uid) selectEdge(t.uid);
        return;
      case "link":
        if (t.key || t.uid) selectLink(t.key || t.uid);
        return;
      case "item":
      case "section-title":
      case "section-border": {
        if (!t.uid || !b?.items.has(t.uid)) return;
        if (state.tool === "connect") {
          beginConnect(t.uid, nearestSide(r.get(t.uid), ev.world), ev.world);
          return;
        }
        if (state.tool !== "select") break;
        let deferred = false;
        if (ev.shift) {
          const next = new Set(state.selection);
          if (next.has(t.uid)) next.delete(t.uid);
          else next.add(t.uid);
          selectItems(next);
        } else if (!state.selection.has(t.uid)) {
          selectItems([t.uid]);
        } else if (state.selection.size > 1) {
          deferred = true;
        } else if (state.edge || state.link) {
          selectItems([t.uid]);
        }
        if (!state.selection.has(t.uid)) return;
        const uids = movingSet();
        begin({ kind: "move", uids, start: ev.screen, target: t.uid, deferred, bounds: movingBounds(uids), others: setting("snap-guides", true) ? otherRects(uids) : [] });
        return;
      }
      default:
        break;
    }
    if (state.tool === "section") {
      begin({ kind: "section-draw", start: ev.world });
      return;
    }
    if (state.tool === "board") {
      begin({ kind: "board-draw", start: ev.world });
      return;
    }
    if (state.tool === "card" || state.tool === "text") {
      begin({ kind: "place", tool: state.tool, start: ev.world });
      return;
    }
    begin({ kind: "marquee", start: ev.world, base: ev.shift ? new Set(state.selection) : /* @__PURE__ */ new Set(), shift: ev.shift });
  };
  const onPointerMove = (ev) => {
    const g = state.gesture;
    if (!g) return;
    if (g.kind === "connect") {
      const b = board();
      const r = rects();
      call("showTempWire", { from: g.from, fromSide: g.fromSide, point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.from ? hit.uid : null;
      if (hover !== state.hover) {
        state.hover = hover;
        call("onHover", hover);
      }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
      return;
    }
    const sdx = ev.screen.x - (g.start.x ?? 0);
    const sdy = ev.screen.y - (g.start.y ?? 0);
    if (g.kind === "pan") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      call("setViewport", { x: g.vp0.x + sdx, y: g.vp0.y + sdy, zoom: g.vp0.zoom });
      return;
    }
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const z = zoom();
      let dx = sdx / z;
      let dy = sdy / z;
      let guides = [];
      if (g.bounds && g.others.length) {
        const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
        const snap = snapMove(moving, g.others, SNAP_PX / z);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }
      g.dx = dx;
      g.dy = dy;
      call("previewMove", g.uids, dx, dy);
      call("showGuides", guides);
      const b = board();
      const r = rects();
      if (b && r) {
        if (!g.exclude) {
          g.exclude = new Set(g.uids);
          for (const u of g.uids) for (const d of descendantsOf(b, u)) g.exclude.add(d);
        }
        const hit = hitTest(b, ev.world, r, { exclude: g.exclude });
        const drop = hit?.part === "body" && (b.items.get(hit.uid)?.kind === "board" && b.items.get(hit.uid)?.enhanced) ? hit.uid : null;
        if (drop !== (g.drop ?? null)) {
          g.drop = drop;
          call("onHover", drop);
        }
      }
      return;
    }
    const wdx = ev.world.x - g.start.x;
    const wdy = ev.world.y - g.start.y;
    if (!g.moved && Math.hypot(wdx, wdy) * zoom() < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    if (g.kind === "marquee") {
      const rect = normRect(g.start, ev.world);
      g.rect = rect;
      call("showMarquee", rect, "select");
      const b = board();
      const r = rects();
      if (b && r) {
        const hits = itemsInRect(b, rect, r, { mode: "contain" });
        const next = new Set(g.base);
        hits.forEach((u) => next.add(u));
        state.selection = next;
        state.edge = null;
        state.link = null;
        emitSelection();
      }
      return;
    }
    if (g.kind === "section-draw" || g.kind === "board-draw") {
      g.rect = normRect(g.start, ev.world);
      call("showMarquee", g.rect, g.kind === "board-draw" ? "board" : "section");
      return;
    }
    if (g.kind === "resize") {
      const b = board();
      const item = b?.items.get(g.uid);
      if (!item) return;
      const min = MIN_SIZES[item.type] || MIN_SIZES.card;
      const r0 = g.rect0;
      const next = { uid: g.uid, x: r0.x, y: r0.y, w: r0.w, h: r0.h };
      if (g.part === "corner" || g.part === "right") next.w = Math.max(min.w, r0.w + wdx);
      if (g.part === "corner" || g.part === "bottom") next.h = Math.max(min.h, r0.h + wdy);
      g.rect = next;
      call("previewRects", [next]);
    }
  };
  const onPointerUp = (ev) => {
    const g = state.gesture;
    if (!g) return;
    const b = board();
    const r = rects();
    switch (g.kind) {
      case "pan":
        break;
      case "marquee":
        if (!g.moved && !g.shift) clearSelection();
        break;
      case "section-draw": {
        const d = DEFAULT_SIZES.section;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.section.w && g.rect.h >= MIN_SIZES.section.h ? g.rect : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createSection", { rect })).then((uid) => {
          if (uid) selectItems([uid]);
        }).catch(() => {
        });
        afterToolUse();
        return;
      }
      case "board-draw": {
        const d = DEFAULT_BOARD_CARD;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.card.w && g.rect.h >= MIN_SIZES.card.h ? g.rect : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createBoard", { rect })).then((uid) => {
          if (uid) selectItems([uid]);
        }).catch(() => {
        });
        afterToolUse();
        return;
      }
      case "place": {
        if (!g.moved) {
          const d = DEFAULT_SIZES[g.tool];
          const at = { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2 };
          end();
          const p = g.tool === "text" ? call("createText", at) : call("createCard", at);
          Promise.resolve(p).then((uid) => {
            if (uid) {
              selectItems([uid]);
              call("enterEdit", uid);
            }
          }).catch(() => {
          });
          afterToolUse();
          return;
        }
        break;
      }
      case "move":
        if (g.moved && g.drop) {
          call("moveIntoBoard", g.uids, g.drop, g.dx || 0, g.dy || 0);
        } else if (g.moved) {
          call("commitMove", g.uids, g.dx || 0, g.dy || 0);
        } else if (g.deferred) {
          selectItems([g.target]);
        }
        break;
      case "resize":
        if (g.moved && g.rect) call("commitRects", [g.rect]);
        break;
      case "connect": {
        const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
        end();
        if (hit && hit.uid === g.from) {
          selectItems([g.from]);
        } else if (hit) {
          const existing = findEdge(b, g.from, hit.uid);
          if (existing) {
            selectEdge(existing.uid);
          } else {
            const toSide = nearestSide(r.get(hit.uid), ev.world);
            Promise.resolve(call("addEdge", { from: g.from, to: hit.uid, fromSide: g.fromSide, toSide })).then((uid) => {
              if (uid) selectEdge(uid);
            }).catch(() => {
            });
          }
        } else if (g.moved) {
          const d = DEFAULT_SIZES.card;
          const at = { x: ev.world.x, y: ev.world.y - d.h / 2 };
          Promise.resolve(call("createCard", at)).then(async (uid) => {
            if (!uid) return;
            await call("addEdge", { from: g.from, to: uid, fromSide: g.fromSide, toSide: "auto" });
            selectItems([uid]);
            call("enterEdit", uid);
          }).catch(() => {
          });
        }
        afterToolUse();
        return;
      }
      default:
        break;
    }
    end();
  };
  const onPointerCancel = () => {
    if (!state.gesture) return;
    const g = state.gesture;
    if (g.kind === "move") call("previewMove", g.uids, 0, 0);
    if (g.kind === "resize") call("previewRects", []);
    end();
  };
  const onDblClick = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    const b = board();
    if (t.kind === "item" && t.uid) {
      const item = b?.items.get(t.uid);
      if (!item) return;
      if (item.kind === "board") call("openBoard", t.uid);
      else if (editingUid() !== t.uid) {
        selectItems([t.uid]);
        call("enterEdit", t.uid);
      }
      return;
    }
    if (t.kind === "section-title" && t.uid) {
      selectItems([t.uid]);
      call("renameSection", t.uid);
      return;
    }
    if ((t.kind === "label" || t.kind === "edge") && t.uid) {
      selectEdge(t.uid);
      call("editLabel", t.uid);
      return;
    }
    if (t.kind === "section-border" || t.kind === "port" || t.kind === "grip" || t.kind === "link") return;
    if (state.tool !== "select") return;
    const d = DEFAULT_SIZES.card;
    Promise.resolve(call("createCard", { x: ev.world.x - d.w / 2, y: ev.world.y - d.h / 2 })).then((uid) => {
      if (uid) {
        selectItems([uid]);
        call("enterEdit", uid);
      }
    }).catch(() => {
    });
  };
  const onWheel = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return false;
    const editing = editingUid();
    if (editing && t.kind === "item" && t.uid === editing) return false;
    const v = vp();
    const pinch = Boolean(ev.ctrl || ev.meta);
    const wheelMode = setting("wheel", "pan");
    if (pinch || wheelMode === "zoom") {
      const factor = Math.exp(-(ev.deltaY || 0) * (pinch ? 0.01 : 2e-3));
      call("setViewport", zoomAt(v, ev.screen, factor));
    } else {
      call("setViewport", { x: v.x - (ev.deltaX || 0), y: v.y - (ev.deltaY || 0), zoom: v.zoom });
    }
    return true;
  };
  const zoomBy = (factor) => {
    const s = call("size") || { width: 0, height: 0 };
    call("setViewport", zoomAt(vp(), { x: s.width / 2, y: s.height / 2 }, factor));
  };
  const zoomTo = (z) => {
    const s = call("size") || { width: 0, height: 0 };
    const v = vp();
    call("setViewport", zoomAt(v, { x: s.width / 2, y: s.height / 2 }, z / (v.zoom || 1)));
  };
  const deleteSelection = (withContents) => {
    if (state.edge) {
      const uid = state.edge;
      selectItems([]);
      call("deleteEdges", [uid]);
      call("toast", { message: "Connection deleted", action: { label: "Undo", run: () => call("undo") } });
      return true;
    }
    if (!state.selection.size) return false;
    const uids = [...state.selection];
    selectItems([]);
    call("deleteItems", uids, { withContents: Boolean(withContents) });
    call("toast", { message: "Deleted", action: { label: "Undo", run: () => call("undo") } });
    return true;
  };
  const escape = () => {
    if (state.gesture) {
      onPointerCancel();
      return true;
    }
    if (isEditing()) {
      call("exitEdit");
      return true;
    }
    if (clearSelection()) return true;
    if (call("popBoard")) return true;
    if (call("isFullscreen")) {
      call("setFullscreen", false);
      return true;
    }
    return false;
  };
  const onKeyDown = (ev) => {
    const key = ev.key || "";
    const mod = Boolean(ev.meta || ev.ctrl);
    if (ev.inputFocused) {
      if (key === "Escape" && isEditing() && !call("autocompleteOpen")) {
        call("exitEdit");
        return true;
      }
      return false;
    }
    if (ev.code === "Space" || key === " ") {
      if (!state.space) {
        state.space = true;
        call("setSpace", true);
      }
      return true;
    }
    if (key === "Escape") return escape();
    if (setting("enable-shortcuts", true) === false) return false;
    const b = board();
    if (mod) {
      const k = key.toLowerCase();
      if (k === "a") {
        if (b) selectItems([...b.items.keys()]);
        return true;
      }
      if (k === "g") {
        if (state.selection.size) call("wrapInSection", [...state.selection]);
        return true;
      }
      if (k === "z") {
        if (ev.shift) call("redo");
        else call("undo");
        return true;
      }
      if (k === "=" || k === "+") {
        zoomBy(1.2);
        return true;
      }
      if (k === "-" || k === "_") {
        zoomBy(1 / 1.2);
        return true;
      }
      return false;
    }
    if (ev.shift) {
      if (ev.code === "Digit1" || key === "!") {
        call("fitAll");
        return true;
      }
      if (ev.code === "Digit2" || key === "@") {
        if (state.selection.size) call("fitSelection", [...state.selection]);
        return true;
      }
      if (ev.code === "Digit0" || key === ")") {
        zoomTo(1);
        return true;
      }
    }
    if (key === "Delete" || key === "Backspace") return deleteSelection(ev.shift);
    if (key === "Enter") {
      if (state.selection.size === 1) {
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind === "board") call("openBoard", uid);
        else if (item?.type === "section") call("renameSection", uid);
        else call("enterEdit", uid);
        return true;
      }
      return false;
    }
    if (key.startsWith("Arrow")) {
      if (!state.selection.size) return false;
      const step = ev.shift ? 10 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      call("commitMove", movingSet(), dx, dy);
      return true;
    }
    if (ev.alt) return false;
    const lower = key.toLowerCase();
    if (TOOL_KEYS[lower]) {
      setTool(TOOL_KEYS[lower]);
      return true;
    }
    if (lower === "l") {
      call("cycleLinks");
      return true;
    }
    if (key === "/") {
      call("openSearch");
      return true;
    }
    return false;
  };
  const onKeyUp = (ev) => {
    if (ev.code === "Space" || ev.key === " ") {
      if (state.space) {
        state.space = false;
        call("setSpace", false);
      }
      return true;
    }
    return false;
  };
  const handle = (ev) => {
    switch (ev?.type) {
      case "pointerdown":
        return onPointerDown(ev);
      case "pointermove":
        return onPointerMove(ev);
      case "pointerup":
        return onPointerUp(ev);
      case "pointercancel":
        return onPointerCancel(ev);
      case "dblclick":
        return onDblClick(ev);
      case "wheel":
        return onWheel(ev);
      case "keydown":
        return onKeyDown(ev);
      case "keyup":
        return onKeyUp(ev);
      default:
        return void 0;
    }
  };
  return {
    handle,
    setTool,
    getTool: () => state.tool,
    isLocked: () => state.locked,
    select: selectItems,
    selectEdge,
    selectLink,
    clearSelection,
    getSelection: () => ({ items: [...state.selection], edge: state.edge, link: state.link }),
    deleteSelection,
    escape,
    isGesturing: () => Boolean(state.gesture),
    gestureKind: () => state.gesture?.kind ?? null,
    cancel: onPointerCancel,
    // Model changed under us: drop selection entries that no longer exist.
    reconcile() {
      const b = board();
      if (!b) return;
      let changed = false;
      for (const u of [...state.selection]) if (!b.items.has(u)) {
        state.selection.delete(u);
        changed = true;
      }
      if (state.edge && !b.edges.has(state.edge)) {
        state.edge = null;
        changed = true;
      }
      if (changed) emitSelection();
    }
  };
}

// src/view/cards.js
var SIDES3 = ["top", "right", "bottom", "left"];
var CHUNK_MS = 8;
var LRU_CAP = 80;
var UNMOUNT_AFTER_MS = 4e3;
var HYDRATE_CAP_MS = 900;
var CONTENT_LIMIT = 12;
var CONTENT_DEPTH = 2;
var GROW_CAP = 900;
var HEADER_H = 32;
var BOARD_KEY_DEPTH = 3;
var BOARD_KEY_NODES = 400;
var now = () => globalThis.performance?.now ? globalThis.performance.now() : Date.now();
function isTextEntryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") === "true") return true;
  if (typeof target.closest !== "function") return false;
  const hit = target.closest('[contenteditable="true"], .pxd-label--editing, .pxd-section__title--editing, .pxd-input');
  return Boolean(hit && !hit.querySelector?.(".pxd-root"));
}
function synthesizeBlockClick(host) {
  if (!host?.dispatchEvent) return false;
  const rect = host.getBoundingClientRect?.() || { left: 0, top: 0, height: 0 };
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: (Number(rect.left) || 0) + 2,
    clientY: (Number(rect.top) || 0) + (Number(rect.height) || 0) / 2
  };
  for (const type of ["mousedown", "mouseup", "click"]) {
    const Ctor = globalThis.MouseEvent || globalThis.Event;
    const event = typeof Ctor === "function" ? new Ctor(type, init) : { type, ...init };
    host.dispatchEvent(event);
  }
  return true;
}
function focusRoamInput(el) {
  if (!el) return false;
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    try {
      el.focus?.();
    } catch {
    }
  }
  synthesizeBlockClick(el);
  return true;
}
function nextFrame() {
  return new Promise((resolve) => {
    const raf2 = globalThis.requestAnimationFrame;
    if (typeof raf2 === "function") raf2(() => resolve());
    else setTimeout(resolve, 16);
  });
}
async function waitHydrateQuiet(el, capMs = HYDRATE_CAP_MS) {
  const MO = globalThis.MutationObserver;
  if (!el || typeof MO !== "function") {
    await nextFrame();
    await nextFrame();
    return;
  }
  let mutations = 0;
  const observer = new MO(() => {
    mutations += 1;
  });
  try {
    observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
  }
  const start = Date.now();
  const grace = 250;
  let quiet = 0;
  let saw = false;
  try {
    while (Date.now() - start < capMs) {
      if (!saw && Date.now() - start >= grace) break;
      await nextFrame();
      if (mutations > 0) {
        saw = true;
        quiet = 0;
      } else if (saw) quiet += 1;
      mutations = 0;
      if (saw && quiet >= 2) break;
    }
  } finally {
    observer.disconnect();
  }
}
var childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
var childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];
var childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";
var childProps = (c) => c?.[":block/props"] ?? c?.props;
function contentKeyOf(item) {
  const parts = [item.kind, item.enhanced ? "e" : "", item.string, item.collapsed ? "c" : "", item.fontSize || ""];
  if (item.kind === "board") {
    let budget = BOARD_KEY_NODES;
    const walkBoard = (kids, depth) => {
      if (depth > BOARD_KEY_DEPTH) return;
      for (const c of kids) {
        if (budget-- <= 0) return;
        parts.push(childUid(c), childString(c), JSON.stringify(childProps(c) ?? null));
        walkBoard(childKids(c), depth + 1);
      }
    };
    walkBoard(item.content || [], 1);
    return parts.join("");
  }
  const walk = (kids, depth) => {
    if (depth > CONTENT_DEPTH) return;
    for (const c of kids) {
      parts.push(childString(c));
      walk(childKids(c), depth + 1);
    }
  };
  walk(item.content || [], 1);
  return parts.join("");
}
function createItemRenderer({
  doc = globalThis.document,
  host,
  session,
  itemsLayer,
  sectionsLayer,
  timers,
  onGrow,
  onRenameCommit,
  onEditChange,
  onOpenBoard,
  onRenameBoard
} = {}) {
  const shells = /* @__PURE__ */ new Map();
  const mounted = /* @__PURE__ */ new Map();
  let lod = "detail";
  let zoomCache = 1;
  let paused = false;
  let editing = null;
  let queue = [];
  let idleHandle = null;
  let wanted = /* @__PURE__ */ new Set();
  let lastBoard = null;
  let lastRects = null;
  let focusGuard = null;
  let floorTeardown = null;
  let floor = null;
  let recoveries = [];
  let lastOutsideDown = -Infinity;
  let disposed = false;
  const later = (fn, ms) => timers?.later ? timers.later(fn, ms) : (() => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  })();
  const idle = (fn) => {
    if (timers?.idle) return timers.idle(fn);
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(fn);
      return () => globalThis.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => fn({ timeRemaining: () => CHUNK_MS, didTimeout: true }), 0);
    return () => clearTimeout(t);
  };
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const renderRoot = (parent, string, cls = "pxd-rs") => {
    const node = el("div", cls, parent);
    if (!string) return node;
    try {
      if (host?.renderString) host.renderString(node, string);
      else node.textContent = plainText(string);
    } catch {
      node.textContent = plainText(string);
    }
    return node;
  };
  const unmountRoots = (rec) => {
    if (!rec.roots?.length) return;
    for (const node of rec.roots) {
      try {
        host?.unmount?.(node);
      } catch {
      }
    }
    rec.roots = [];
  };
  const buildPorts = (parent) => {
    const wrap = el("div", "pxd-ports", parent);
    for (const side of SIDES3) {
      const p = el("div", `pxd-port pxd-port--${side}`, wrap);
      p.dataset.side = side;
      p.setAttribute("data-side", side);
      p.title = "Drag to connect";
    }
    return wrap;
  };
  const buildGrips = (parent) => {
    for (const part of ["right", "bottom", "corner"]) {
      const g = el("div", `pxd-grip pxd-grip--${part}`, parent);
      g.dataset.part = part;
      g.setAttribute("data-part", part);
    }
  };
  const buildShell = (item) => {
    const rec = { uid: item.uid, type: item.type, roots: [], contentKey: null, rect: null };
    if (item.type === "section") {
      const node = el("div", "pxd-section", null);
      rec.el = node;
      rec.title = el("div", "pxd-section__title", node);
      for (const side of ["t", "r", "b", "l"]) el("div", `pxd-section__edge pxd-section__edge--${side}`, node);
      buildGrips(node);
      buildPorts(node);
    } else {
      const node = el("div", `pxd-item pxd-item--${item.type}`, null);
      rec.el = node;
      rec.header = el("div", "pxd-item__header", node);
      rec.body = el("div", "pxd-item__body", node);
      buildPorts(node);
      buildGrips(node);
    }
    rec.el.dataset.uid = item.uid;
    rec.el.setAttribute("data-uid", item.uid);
    shells.set(item.uid, rec);
    return rec;
  };
  const paintShell = (rec, item) => {
    const node = rec.el;
    const base = item.type === "section" ? "pxd-section" : `pxd-item pxd-item--${item.type} pxd-item--${item.kind}`;
    const cls = [base];
    if (item.color) cls.push(`pxd-c-${item.color}`);
    if (item.collapsed) cls.push("pxd-item--collapsed");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && item.fontSize) cls.push(`pxd-item--fs${item.fontSize}`);
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push("pxd-item--editing");
    node.className = cls.join(" ");
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
    } else {
      if (item.kind === "block" && item.target?.uid) {
        const refString = host?.blockString?.(item.target.uid);
        rec.refTitle = typeof refString === "string" ? firstLine(refString) : "";
      } else rec.refTitle = "";
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : rec.refTitle || item.title || "";
      if (item.type === "text") rec.header.style.display = "none";
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node.title = "";
  };
  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    if (editing?.uid === rec.uid) {
      if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
      rec.el.style.minHeight = `${rect.h}px`;
    }
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${rect.w}px`;
    rec.el.style.height = `${rect.h}px`;
  };
  const removeShell = (uid) => {
    const rec = shells.get(uid);
    if (!rec) return;
    if (editing?.uid === uid) void exitEdit({ silent: true });
    unmountRoots(rec);
    rec.el.remove();
    shells.delete(uid);
    mounted.delete(uid);
  };
  const sync = ({ board, rects, dirty = null, structural = false }) => {
    lastBoard = board;
    lastRects = rects;
    for (const uid of [...shells.keys()]) if (!board.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    for (const uid of board.order) {
      const item = board.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) {
        rec = buildShell(item);
        orderChanged = true;
      }
      const rect = rects.get(uid);
      if (fresh || !dirty || dirty.has(uid)) {
        paintShell(rec, item);
        if (rect) position(rec, rect);
        const key = contentKeyOf(item);
        if (rec.contentKey !== null && rec.contentKey !== key && editing?.uid !== uid) {
          unmountRoots(rec);
          rec.body?.replaceChildren?.();
          rec.contentKey = null;
          mounted.delete(uid);
          rec.titleRendered = false;
        }
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) {
      for (const uid of board.order) {
        const rec = shells.get(uid);
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
    }
  };
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      budget.n += 1;
      const row = el("div", "pxd-block", parent);
      row.dataset.uid = childUid(b);
      const s = childString(b);
      const node = renderRoot(row, s, "pxd-rs pxd-block__text");
      budget.roots.push(node);
      const kids = childKids(b);
      if (kids.length && depth < CONTENT_DEPTH) {
        const wrap = el("div", "pxd-block__children", row);
        renderBlocks(wrap, kids, depth + 1, budget);
      }
    }
  };
  const openBoard = (uid) => {
    if (onOpenBoard) onOpenBoard(uid);
    else host?.openBlock?.(uid);
  };
  const commitBoardName = (uid, name) => (onRenameBoard || ((u, n) => session?.renameBoard?.(u, n)))(uid, name);
  const mountBoardBody = (body, item) => {
    const preview = boardPreview(item);
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    const canvas = el("div", "pxd-board-preview__canvas", holder);
    canvas.style.aspectRatio = String(preview.aspect);
    const pct = (n) => `${Math.round(n * 1e4) / 100}%`;
    for (const r of preview.rects) {
      const cls = ["pxd-mini"];
      if (r.type === "section") cls.push("pxd-mini--section");
      else if (r.type === "text") cls.push("pxd-mini--text");
      if (r.color) cls.push(`pxd-c-${r.color}`);
      const mini = el("div", cls.join(" "), canvas);
      mini.style.left = pct(r.x);
      mini.style.top = pct(r.y);
      mini.style.width = pct(r.w);
      mini.style.height = pct(r.h);
    }
    if (item.enhanced && isUntitledBoard(item.title)) {
      const input = el("input", "pxd-input pxd-item__board-name", wrap);
      input.type = "text";
      input.placeholder = "Name this board…";
      input.setAttribute("placeholder", "Name this board…");
      for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) input.addEventListener(type, stopEvent);
      let done = false;
      const commit = () => {
        if (done) return;
        const name = String(input.value || "").trim();
        if (!name) return;
        done = true;
        commitBoardName(item.uid, name);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          input.blur?.();
        } else if (event.key === "Escape") {
          event.preventDefault();
          input.value = "";
          input.blur?.();
        }
      });
      input.addEventListener("blur", commit);
    }
    const meta = el("div", "pxd-item__board-meta", wrap);
    el("span", "pxd-item__board-count", meta).textContent = preview.count ? `${preview.count} ${preview.count === 1 ? "item" : "items"}` : "Empty board";
    const open = el("button", "pxd-btn pxd-item__open", meta);
    open.type = "button";
    open.textContent = "Open";
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      openBoard(item.uid);
    });
  };
  const mountContent = (rec, item) => {
    const body = rec.body;
    unmountRoots(rec);
    body.replaceChildren();
    const budget = { n: 0, roots: [] };
    if (item.collapsed) {
      rec.contentKey = contentKeyOf(item);
      rec.roots = [];
      return;
    }
    if (item.type === "text") {
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text"));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      const holder = el("div", "pxd-item__page", body);
      const preview = host?.pagePreview?.(item.title, CONTENT_DEPTH, CONTENT_LIMIT);
      const apply = (p, sync2 = false) => {
        if (disposed || !holder.parentElement || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
        if (!p?.exists) {
          el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
          return;
        }
        const b = { n: 0, roots: [] };
        renderBlocks(holder, p.blocks || [], 1, b);
        rec.roots.push(...b.roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {
      });
      else apply(preview, true);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      rec.refTitle = typeof refString === "string" ? firstLine(refString) : "";
      if (editing?.uid !== item.uid) rec.header.textContent = rec.refTitle || item.title || "";
      if (typeof refString === "string" && refString.trim()) budget.roots.push(renderRoot(body, refString, "pxd-rs pxd-item__string"));
      const tree = host?.pullTree?.(ref, CONTENT_DEPTH, CONTENT_LIMIT);
      const apply = (blocks, sync2 = false) => {
        if (disposed || !body.isConnected || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
        if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
        const b = { n: 0, roots: [] };
        renderBlocks(body, blocks || [], 1, b);
        rec.roots.push(...b.roots);
      };
      if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {
      });
      else apply(tree, true);
    } else {
      if (item.string?.trim()) budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__string"));
      renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyOf(item);
  };
  const mountSectionTitle = (rec, item) => {
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text");
    if (!item.string) node.textContent = "Section";
    rec.roots = [node];
    rec.titleRendered = true;
    rec.contentKey = contentKeyOf(item);
  };
  const unmountContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || editing?.uid === uid) return;
    unmountRoots(rec);
    if (rec.type === "section") {
      rec.title.replaceChildren();
      rec.title.textContent = lastBoard?.items.get(uid)?.title || "Section";
      rec.titleRendered = false;
    } else {
      rec.body?.replaceChildren?.();
    }
    rec.contentKey = null;
    mounted.delete(uid);
  };
  const pump = (deadline) => {
    idleHandle = null;
    if (disposed || paused || !lastBoard) return;
    const start = now();
    const has = deadline && typeof deadline.timeRemaining === "function" ? () => deadline.timeRemaining() > 1 : () => true;
    while (queue.length && now() - start < CHUNK_MS && has()) {
      const uid = queue.shift();
      if (!wanted.has(uid) || mounted.has(uid)) continue;
      const rec = shells.get(uid);
      const item = lastBoard.items.get(uid);
      if (!rec || !item || editing?.uid === uid) continue;
      if (rec.type === "section") mountSectionTitle(rec, item);
      else mountContent(rec, item);
      mounted.delete(uid);
      mounted.set(uid, now());
    }
    if (queue.length) idleHandle = idle(pump);
    evict();
  };
  const evict = () => {
    if (mounted.size <= LRU_CAP) return;
    const victims = [];
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!wanted.has(uid)) victims.push(uid);
    }
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!victims.includes(uid)) victims.push(uid);
    }
    victims.forEach(unmountContent);
  };
  let unmountTimer = null;
  const scheduleUnmounts = () => {
    if (unmountTimer) return;
    unmountTimer = later(() => {
      unmountTimer = null;
      if (disposed) return;
      const t = now();
      for (const [uid, seen] of [...mounted]) {
        if (!wanted.has(uid) && t - seen >= UNMOUNT_AFTER_MS - 1) unmountContent(uid);
      }
      if ([...mounted.keys()].some((u) => !wanted.has(u))) scheduleUnmounts();
    }, UNMOUNT_AFTER_MS);
  };
  const scheduleContent = ({ visibleRect, zoom = zoomCache }) => {
    zoomCache = zoom;
    if (!lastBoard || !lastRects) return;
    const next = /* @__PURE__ */ new Set();
    if (lodForZoom(zoom) === "detail") {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if (r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    } else {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if ((rec.type === "section" || rec.type === "text") && r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    }
    wanted = next;
    const t = now();
    for (const uid of next) if (mounted.has(uid)) mounted.set(uid, t);
    queue = [...next].filter((u) => !mounted.has(u));
    if (queue.length && !paused && !idleHandle) idleHandle = idle(pump);
    if ([...mounted.keys()].some((u) => !next.has(u))) scheduleUnmounts();
  };
  const setPaused = (on) => {
    paused = Boolean(on);
    if (paused && idleHandle) {
      idleHandle();
      idleHandle = null;
    }
    if (!paused && queue.length && !idleHandle) idleHandle = idle(pump);
  };
  const setLod = (nextLod, zoom) => {
    lod = nextLod;
    zoomCache = zoom;
  };
  const previewMove = (uids, dx, dy, board, rects) => {
    const set = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(board, u)) set.add(d);
    const live = /* @__PURE__ */ new Map();
    for (const uid of set) {
      const rec = shells.get(uid);
      const r = rects.get(uid);
      if (!rec || !r) continue;
      const moved = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
      rec.el.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
      live.set(uid, moved);
    }
    return live;
  };
  const previewRects = (list) => {
    const live = /* @__PURE__ */ new Map();
    for (const r of list) {
      const rec = shells.get(r.uid);
      if (!rec) continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };
  const setSelection = (uids) => {
    const set = new Set(uids);
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      if (rec.selected === on) continue;
      rec.selected = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
    }
  };
  const setHover = (uid) => {
    for (const [u, rec] of shells) {
      const on = u === uid;
      if (rec.hover === on) continue;
      rec.hover = on;
      rec.el.classList.toggle("pxd-item--drop", on);
    }
  };
  const onFocusSteal = (event) => {
    if (!editing) return;
    const target = event.target;
    if (!target || editing.editor.contains?.(target)) return;
    const isInput = target.classList?.contains?.("rm-block__input") || String(target.tagName || "").toLowerCase() === "textarea";
    if (!isInput) return;
    const hostEl = typeof target.closest === "function" ? target.closest("[data-uid]") : null;
    const uid = hostEl?.dataset?.uid || String(target.id || "").match(/([A-Za-z0-9_-]{9})$/)?.[1];
    if (uid !== editing.targetUid) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const onDocPointerDown = (event) => {
    if (!editing) return;
    if (editing.rec.el.contains?.(event.target)) return;
    lastOutsideDown = now();
  };
  const attachFocusGuard = () => {
    if (focusGuard || typeof doc.addEventListener !== "function") return;
    doc.addEventListener("focus", onFocusSteal, true);
    doc.addEventListener("scroll", onFocusSteal, true);
    doc.addEventListener("pointerdown", onDocPointerDown, true);
    focusGuard = () => {
      doc.removeEventListener("focus", onFocusSteal, true);
      doc.removeEventListener("scroll", onFocusSteal, true);
      doc.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  };
  const detachFocusGuard = () => {
    floorTeardown?.();
    floorTeardown = null;
    focusGuard?.();
    focusGuard = null;
  };
  const FLOOR_WINDOW_MS = 600;
  const FLOOR_POINTER_MS = 300;
  const FLOOR_MAX = 4;
  const FLOOR_SPAN_MS = 1500;
  const frameLater = (fn) => {
    if (timers?.frame) return timers.frame(fn);
    const raf2 = globalThis.requestAnimationFrame;
    if (typeof raf2 === "function") {
      const id = raf2(fn);
      return () => globalThis.cancelAnimationFrame?.(id);
    }
    const t = setTimeout(fn, 16);
    return () => clearTimeout(t);
  };
  const rootOfLayer = () => itemsLayer?.closest?.(".pxd-root") ?? null;
  const focusLost = (a) => !a || a === doc.body || a === doc.documentElement || a === rootOfLayer();
  const findLiveTextarea = (e) => {
    const list = [...e.editor.querySelectorAll?.("textarea") || []];
    if (!list.length) return null;
    const ta = [...list].reverse().find((n) => String(n.id || "").startsWith("block-input-")) || list[list.length - 1];
    return ta?.isConnected ? ta : null;
  };
  const floorTick = (e) => {
    const f = floor;
    if (!f) return;
    f.cancel = null;
    const stop = () => {
      if (floor === f) floor = null;
    };
    if (editing !== e || disposed || lastOutsideDown > f.start - FLOOR_POINTER_MS || doc.hasFocus?.() === false) return stop();
    const a = doc.activeElement;
    if (e.editor.contains?.(a)) return stop();
    if (!focusLost(a)) return stop();
    const ta = findLiveTextarea(e);
    if (ta) {
      recoveries.push(now());
      focusRoamInput(ta);
      return stop();
    }
    if (now() - f.start < FLOOR_WINDOW_MS) f.cancel = frameLater(() => floorTick(e));
    else stop();
  };
  const armFloor = () => {
    const e = editing;
    if (!e || disposed || !e.ready || floor) return false;
    const t = now();
    recoveries = recoveries.filter((x) => t - x < FLOOR_SPAN_MS);
    if (recoveries.length >= FLOOR_MAX) return false;
    floor = { start: t, cancel: null };
    floor.cancel = frameLater(() => floorTick(e));
    return true;
  };
  const attachFloor = (e) => {
    const onIn = () => {
      e.ready = true;
    };
    const onOut = (event) => {
      if (editing !== e || !e.ready) return;
      const to = event.relatedTarget;
      if (to) return;
      armFloor();
    };
    e.editor.addEventListener("focusin", onIn);
    e.editor.addEventListener("focusout", onOut);
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    let mo = null;
    if (typeof MO === "function") {
      mo = new MO(() => {
        if (editing === e && e.ready && focusLost(doc.activeElement)) armFloor();
      });
      try {
        mo.observe(e.editor, { childList: true, subtree: true });
      } catch {
      }
    }
    floorTeardown = () => {
      e.editor.removeEventListener("focusin", onIn);
      e.editor.removeEventListener("focusout", onOut);
      mo?.disconnect();
      floor?.cancel?.();
      floor = null;
    };
  };
  const recoverFocus = () => armFloor();
  const stopEvent = (event) => event.stopPropagation();
  const enterEdit = async (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type === "section" || item.kind === "board") return false;
    if (editing?.uid === uid) return true;
    if (editing) await exitEdit();
    if (!host?.renderBlock) {
      host?.openBlock?.(uid);
      return false;
    }
    const targetUid = item.target.kind === "block" ? item.target.uid : item.uid;
    unmountRoots(rec);
    rec.body.replaceChildren();
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", "pxd-item__editor", rec.body);
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false };
    rec.el.classList.add("pxd-item--editing");
    if (rec.rect) rec.el.style.minHeight = `${rec.rect.h}px`;
    lastOutsideDown = -Infinity;
    attachFocusGuard();
    attachFloor(editing);
    onEditChange?.(uid);
    let ok = true;
    try {
      if (item.kind === "page") {
        const pageUid = host.pageUid?.(item.title);
        if (pageUid && host.renderPage) host.renderPage(editor, pageUid);
        else host.renderBlock(editor, item.uid);
      } else {
        host.renderBlock(editor, targetUid);
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      await exitEdit({ silent: true });
      return false;
    }
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || editing?.uid !== uid) return false;
    const input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    if (input) focusRoamInput(input);
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    return true;
  };
  const exitEdit = async ({ silent = false } = {}) => {
    const e = editing;
    if (!e) return;
    editing = null;
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
    const contentH = Number(editor.scrollHeight) || 0;
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) editor.removeEventListener(type, stopEvent);
    try {
      host?.unmount?.(editor);
    } catch {
    }
    editor.remove();
    rec.el.classList.remove("pxd-item--editing");
    rec.el.style.minHeight = "";
    rec.contentKey = null;
    mounted.delete(uid);
    if (!silent && !disposed) {
      const live = lastBoard?.items.get(uid) || item;
      if (live && shells.has(uid)) {
        mountContent(rec, live);
        paintShell(rec, live);
        mounted.set(uid, now());
      }
      onEditChange?.(null);
      const need = contentH + (["page", "board"].includes(item.kind) || item.collapsed ? HEADER_H : 0) + 20;
      if (contentH > 0 && live && need > live.h) {
        const grow = Math.min(GROW_CAP, need);
        if (grow > live.h) (onGrow || ((u, h) => session?.growToFit?.(u, h)))(uid, grow);
      }
    }
  };
  const autocompleteOpen = () => Boolean(doc.querySelector?.(".rm-autocomplete__results"));
  const renameSection = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type !== "section") return false;
    const t = rec.title;
    unmountRoots(rec);
    t.replaceChildren();
    t.textContent = item.string || "";
    t.classList.add("pxd-section__title--editing");
    t.contentEditable = "true";
    t.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      t.contentEditable = "false";
      t.removeAttribute("contenteditable");
      t.classList.remove("pxd-section__title--editing");
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      t.removeEventListener("pointerdown", stopEvent);
      const next = String(t.textContent || "").trim();
      rec.titleRendered = false;
      rec.contentKey = null;
      mounted.delete(uid);
      if (commit && next !== item.string) (onRenameCommit || ((u, s) => session?.setString?.(u, s)))(uid, next);
      else t.textContent = item.title || "Section";
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
    t.addEventListener("pointerdown", stopEvent);
    try {
      t.focus({ preventScroll: true });
    } catch {
      t.focus?.();
    }
    try {
      const d = t.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(t);
      const s = d.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
    }
    return true;
  };
  const renameBoard = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "board" || !item.enhanced || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = parseBoardTitle(item.string);
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.classList.remove("pxd-item__header--muted");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      h.removeEventListener("keydown", onKey);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = live.title || "";
      h.classList.toggle("pxd-item__header--muted", isUntitledBoard(live.title));
      if (commit && next !== seed) commitBoardName(uid, next);
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    h.addEventListener("keydown", onKey);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try {
      h.focus({ preventScroll: true });
    } catch {
      h.focus?.();
    }
    try {
      const d = h.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(h);
      const sel = d.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
    }
    return true;
  };
  const dispose = () => {
    disposed = true;
    if (editing) {
      const e = editing;
      editing = null;
      detachFocusGuard();
      for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) e.editor.removeEventListener(type, stopEvent);
      try {
        host?.unmount?.(e.editor);
      } catch {
      }
    }
    if (idleHandle) {
      idleHandle();
      idleHandle = null;
    }
    if (unmountTimer) {
      unmountTimer();
      unmountTimer = null;
    }
    for (const uid of [...shells.keys()]) {
      const rec = shells.get(uid);
      unmountRoots(rec);
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    queue = [];
  };
  return {
    sync,
    scheduleContent,
    setPaused,
    setLod,
    previewMove,
    previewRects,
    setSelection,
    setHover,
    enterEdit,
    exitEdit,
    editingUid: () => editing?.uid ?? null,
    isEditing: () => Boolean(editing),
    recoverFocus,
    autocompleteOpen,
    renameSection,
    renameBoard,
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose
  };
}

// src/view/edges.js
var SVG_NS = "http://www.w3.org/2000/svg";
var PAIR_OFFSET = 18;
var LABEL_HIDE_ZOOM = 0.3;
var setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};
function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit } = {}) {
  const edgeEls = /* @__PURE__ */ new Map();
  const linkEls = /* @__PURE__ */ new Map();
  let wire = null;
  let marquee = null;
  const guideEls = [];
  let zoomCache = 1;
  let editingLabel = null;
  const listeners2 = [];
  const mk = (tag, cls, parent) => {
    const el = doc.createElementNS(SVG_NS, tag);
    setClass(el, cls);
    parent?.append(el);
    return el;
  };
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners2.push(() => el.removeEventListener(type, fn, opts));
  };
  const pairOffset = (board, edge) => {
    for (const other of board.edges.values()) {
      if (other.uid !== edge.uid && other.from === edge.to && other.to === edge.from) {
        return edge.uid < other.uid ? PAIR_OFFSET : -PAIR_OFFSET;
      }
    }
    return 0;
  };
  const geometryFor = (board, edge, rects) => {
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) return null;
    return edgePath({ a, b, fromSide: edge.fromSide, toSide: edge.toSide, route: edge.route, offset: pairOffset(board, edge) });
  };
  const buildEdge = (edge) => {
    const g = mk("g", "pxd-edge", svg);
    g.dataset.uid = edge.uid;
    g.setAttribute("data-uid", edge.uid);
    const hit = mk("path", "pxd-edge__hit", g);
    const line = mk("path", "pxd-edge__line", g);
    const tail = mk("path", "pxd-edge__head pxd-edge__tail", g);
    const head = mk("path", "pxd-edge__head", g);
    const dot = mk("circle", "pxd-edge__dot", g);
    dot.setAttribute("r", "4");
    const label = doc.createElement("div");
    label.className = "pxd-label";
    label.dataset.uid = edge.uid;
    label.setAttribute("data-uid", edge.uid);
    labelsLayer?.append(label);
    const rec = { g, hit, line, head, tail, dot, label, geo: null };
    edgeEls.set(edge.uid, rec);
    return rec;
  };
  const paintEdge = (board, edge, rec, { covered, selected }) => {
    const cls = ["pxd-edge"];
    if (edge.color) cls.push(`pxd-c-${edge.color}`);
    if (edge.dash === "dashed") cls.push("pxd-edge--dashed");
    if (edge.weight > 1) cls.push(`pxd-edge--w${edge.weight}`);
    if (selected) cls.push("pxd-edge--selected");
    if (covered) cls.push("pxd-edge--covered");
    if (!edge.valid) cls.push("pxd-edge--invalid");
    setClass(rec.g, cls.join(" "));
    rec.label.className = `pxd-label${edge.color ? ` pxd-c-${edge.color}` : ""}${edge.label ? "" : " pxd-label--empty"}${selected ? " pxd-label--selected" : ""}`;
    if (editingLabel?.uid !== edge.uid) rec.label.textContent = edge.label || "";
    rec.dir = edge.dir;
    rec.weight = edge.weight;
  };
  const placeEdge = (board, edge, rec, rects, zoom) => {
    const geo = geometryFor(board, edge, rects);
    rec.geo = geo;
    if (!geo) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      return;
    }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    const size = arrowSize(zoom, edge.weight);
    if (edge.dir === "none") {
      rec.head.setAttribute("display", "none");
      rec.tail.setAttribute("display", "none");
    } else {
      rec.head.removeAttribute("display");
      rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, size));
      if (edge.dir === "two") {
        rec.tail.removeAttribute("display");
        rec.tail.setAttribute("d", arrowHeadPath(geo.start, geo.startAngle + Math.PI, size));
      } else {
        rec.tail.setAttribute("display", "none");
      }
    }
    rec.dot.setAttribute("cx", String(geo.mid.x));
    rec.dot.setAttribute("cy", String(geo.mid.y));
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };
  const buildLink = (link) => {
    const g = mk("g", "pxd-link", svg);
    g.dataset.key = link.key;
    g.setAttribute("data-key", link.key);
    const hit = mk("path", "pxd-link__hit", g);
    const line = mk("path", "pxd-link__line", g);
    const head = mk("path", "pxd-link__head", g);
    const label = doc.createElement("div");
    label.className = "pxd-label pxd-label--link";
    label.dataset.key = link.key;
    label.setAttribute("data-key", link.key);
    labelsLayer?.append(label);
    const rec = { g, hit, line, head, label, geo: null };
    linkEls.set(link.key, rec);
    return rec;
  };
  const placeLink = (link, rec, rects, zoom, selected) => {
    const a = rects.get(link.from);
    const b = rects.get(link.to);
    setClass(rec.g, `pxd-link pxd-c-${link.color || "gray"}${selected ? " pxd-link--selected" : ""}`);
    rec.label.className = `pxd-label pxd-label--link pxd-c-${link.color || "gray"}${selected ? " pxd-label--selected" : ""}`;
    rec.label.textContent = link.labels?.[0] || "mentions";
    if (!a || !b) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      return;
    }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    const geo = edgePath({ a, b, route: "curve" });
    rec.geo = geo;
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1) * 0.8));
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };
  const removeEdge = (uid) => {
    const rec = edgeEls.get(uid);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    edgeEls.delete(uid);
  };
  const removeLink = (key) => {
    const rec = linkEls.get(key);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    linkEls.delete(key);
  };
  const render = ({ board, rects, links = [], coveredEdges = /* @__PURE__ */ new Set(), selection = {}, zoom = 1, dirty = null }) => {
    zoomCache = zoom;
    for (const uid of [...edgeEls.keys()]) if (!board.edges.has(uid)) removeEdge(uid);
    for (const edge of board.edges.values()) {
      let rec = edgeEls.get(edge.uid);
      const fresh = !rec;
      if (!rec) rec = buildEdge(edge);
      if (fresh || !dirty || dirty.has(edge.uid)) {
        paintEdge(board, edge, rec, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
        placeEdge(board, edge, rec, rects, zoom);
      }
    }
    const keys = new Set(links.map((l) => l.key));
    for (const key of [...linkEls.keys()]) if (!keys.has(key)) removeLink(key);
    for (const link of links) {
      const rec = linkEls.get(link.key) || buildLink(link);
      placeLink(link, rec, rects, zoom, selection.link === link.key);
    }
    labelsLayer?.classList.toggle("pxd-labels--hidden", zoom < LABEL_HIDE_ZOOM);
  };
  const update = ({ board, edgeUids, rects, zoom = zoomCache, linkKeys = null, links = [] }) => {
    for (const uid of edgeUids) {
      const edge = board.edges.get(uid);
      const rec = edgeEls.get(uid);
      if (edge && rec) placeEdge(board, edge, rec, rects, zoom);
    }
    if (linkKeys) {
      for (const link of links) {
        if (!linkKeys.has(link.key)) continue;
        const rec = linkEls.get(link.key);
        if (rec) placeLink(link, rec, rects, zoom, rec.g.getAttribute("class")?.includes("--selected"));
      }
    }
  };
  const setSelection = ({ edge = null, link = null } = {}) => {
    for (const [uid, rec] of edgeEls) {
      const on = uid === edge;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-edge--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-edge--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
    }
    for (const [key, rec] of linkEls) {
      const on = key === link;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-link--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-link--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
    }
  };
  const setTempWire = (spec, rects, zoom = zoomCache) => {
    if (!spec) {
      wire?.line.remove();
      wire?.head.remove();
      wire = null;
      return;
    }
    if (!wire) {
      wire = { line: mk("path", "pxd-wire", overlaySvg), head: mk("path", "pxd-wire__head", overlaySvg) };
    }
    const a = rects.get(spec.from);
    if (!a) return;
    const b = { x: spec.point.x, y: spec.point.y, w: 0, h: 0 };
    const geo = edgePath({ a, b, fromSide: spec.fromSide || "auto", toSide: "auto", route: "curve" });
    wire.line.setAttribute("d", geo.d);
    wire.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1)));
  };
  const setGuides = (guides = []) => {
    while (guideEls.length > guides.length) guideEls.pop().remove();
    while (guideEls.length < guides.length) guideEls.push(mk("line", "pxd-guide", overlaySvg));
    guides.forEach((gd, i) => {
      const el = guideEls[i];
      el.setAttribute("x1", String(gd.x1));
      el.setAttribute("y1", String(gd.y1));
      el.setAttribute("x2", String(gd.x2));
      el.setAttribute("y2", String(gd.y2));
    });
  };
  const setMarquee = (rect, kind = "select") => {
    if (!rect) {
      marquee?.remove();
      marquee = null;
      return;
    }
    if (!marquee) marquee = mk("rect", "pxd-marquee", overlaySvg);
    setClass(marquee, `pxd-marquee${kind === "section" ? " pxd-marquee--section" : ""}`);
    marquee.setAttribute("x", String(rect.x));
    marquee.setAttribute("y", String(rect.y));
    marquee.setAttribute("width", String(rect.w));
    marquee.setAttribute("height", String(rect.h));
  };
  const editLabel = (uid) => {
    const rec = edgeEls.get(uid);
    if (!rec || editingLabel) return false;
    const el = rec.label;
    const previous = el.textContent || "";
    editingLabel = { uid, previous };
    el.classList.remove("pxd-label--empty");
    el.classList.add("pxd-label--editing");
    el.contentEditable = "true";
    el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    const finish = (commit) => {
      if (!editingLabel || editingLabel.uid !== uid) return;
      editingLabel = null;
      el.contentEditable = "false";
      el.removeAttribute("contenteditable");
      el.classList.remove("pxd-label--editing");
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", stop);
      const next = String(el.textContent || "").trim();
      if (commit && next !== previous) onLabelCommit?.(uid, next);
      else el.textContent = previous;
      if (!el.textContent) el.classList.add("pxd-label--empty");
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    const stop = (event) => event.stopPropagation();
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", stop);
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus?.();
    }
    try {
      const d = el.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(el);
      const s = d.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
    }
    return true;
  };
  const geometryOf = (uid) => edgeEls.get(uid)?.geo ?? null;
  const linkGeometryOf = (key) => linkEls.get(key)?.geo ?? null;
  const labelRect = (uid) => {
    const rec = edgeEls.get(uid);
    return rec ? rec.label.getBoundingClientRect() : null;
  };
  const dispose = () => {
    for (const uid of [...edgeEls.keys()]) removeEdge(uid);
    for (const key of [...linkEls.keys()]) removeLink(key);
    setTempWire(null);
    setGuides([]);
    setMarquee(null);
    listeners2.splice(0).forEach((off) => off());
    editingLabel = null;
  };
  return {
    render,
    update,
    setSelection,
    setTempWire,
    setGuides,
    setMarquee,
    editLabel,
    isEditingLabel: () => Boolean(editingLabel),
    geometryOf,
    linkGeometryOf,
    labelRect,
    labelEl: (uid) => edgeEls.get(uid)?.label ?? null,
    portPoint: (rect, side) => sidePoint(rect, side),
    dispose,
    _els: edgeEls
  };
}

// src/view/chrome.js
var CTX_GAP = 12;
var CTX_EDGE_CLEARANCE = 28;
var CTX_MARGIN = 8;
var TOAST_MS = 6e3;
var MINIMAP_W = 180;
var MINIMAP_H = 120;
var LINK_MODES2 = ["off", "attributes", "all"];
var LINK_LABELS = { off: "Links: Off", attributes: "Links: Attributes", all: "Links: All" };
var TOOL_LIST = [
  ["select", "Select", "V"],
  ["hand", "Hand", "H"],
  ["card", "Card", "N"],
  ["text", "Text", "T"],
  ["section", "Section", "G"],
  ["board", "Board", "W"],
  ["connect", "Connect", "C"]
];
var MAX_CRUMBS = 4;
function createChrome({ doc = globalThis.document, root, version = "", settings, timers, on = {}, crumbs = [] } = {}) {
  const setting = (k) => typeof settings?.get === "function" ? settings.get(k) : settings?.[k];
  const listeners2 = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    listeners2.push(() => el2.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    listen(b, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
  };
  const swatches = (parent, onPick) => {
    const wrap = el("div", "pxd-swatches", parent);
    const none = button(wrap, "pxd-swatch pxd-swatch--none", "", "No color", () => onPick(null));
    none.dataset.color = "";
    for (const c of PALETTE) {
      const s = button(wrap, `pxd-swatch pxd-c-${c}`, "", c, () => onPick(c));
      s.dataset.color = c;
      s.setAttribute("data-color", c);
    }
    return wrap;
  };
  const stopAll = (node) => {
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"]) {
      listen(node, type, (event) => event.stopPropagation());
    }
  };
  const toolbar = el("div", "pxd-toolbar pxd-chrome", root);
  stopAll(toolbar);
  const crumbsEl = el("div", "pxd-toolbar__group pxd-crumbs", toolbar);
  listen(crumbsEl, "click", (event) => {
    const hit = event.target?.closest?.(".pxd-crumb[data-index]");
    const raw = hit?.dataset?.index ?? hit?.getAttribute?.("data-index");
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isFinite(index)) return;
    event.preventDefault?.();
    event.stopPropagation();
    on.crumb?.(index);
  });
  const renderCrumbs = (list) => {
    crumbsEl.replaceChildren();
    const items = Array.isArray(list) ? list : [];
    crumbsEl.style.display = items.length < 2 ? "none" : "";
    if (items.length < 2) return;
    const last = items.length - 1;
    let shown = items.map((c, i) => i);
    let hidden = [];
    if (items.length > MAX_CRUMBS) {
      shown = [0, last - 2, last - 1, last];
      hidden = items.slice(1, last - 2);
    }
    shown.forEach((i, n) => {
      if (n === 1 && hidden.length) {
        const more = el("span", "pxd-crumb__more", crumbsEl, "…");
        more.title = hidden.map((c2) => c2.title).join(" › ");
        el("span", "pxd-crumb__sep", crumbsEl, "›");
      }
      const c = items[i];
      if (i === last) {
        const cur = el("span", "pxd-crumb pxd-crumb--current", crumbsEl, c.title);
        cur.title = c.title;
        return;
      }
      const b = el("button", "pxd-btn pxd-crumb", crumbsEl, c.title);
      b.type = "button";
      b.title = c.title;
      b.dataset.index = String(i);
      b.setAttribute("data-index", String(i));
      el("span", "pxd-crumb__sep", crumbsEl, "›");
    });
  };
  renderCrumbs(crumbs);
  const toolGroup = el("div", "pxd-toolbar__group", toolbar);
  const toolButtons = /* @__PURE__ */ new Map();
  for (const [id, label, key] of TOOL_LIST) {
    const b = button(toolGroup, "pxd-tool", label, `${label} (${key}). Double-click to lock`, () => on.setTool?.(id, false));
    b.dataset.tool = id;
    b.setAttribute("data-tool", id);
    listen(b, "dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      on.setTool?.(id, true);
    });
    toolButtons.set(id, b);
  }
  const group2 = el("div", "pxd-toolbar__group", toolbar);
  const addBtn = button(group2, "pxd-toolbar__add", "Add", "Add cards from the graph", () => on.togglePanel?.());
  const linksBtn = button(group2, "pxd-toolbar__links", LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const group3 = el("div", "pxd-toolbar__group", toolbar);
  button(group3, "pxd-toolbar__zoom-out", "−", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  button(group3, "pxd-toolbar__zoom-in", "+", "Zoom in (Cmd =)", () => on.zoomIn?.());
  button(group3, "pxd-toolbar__fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = button(group3, "pxd-toolbar__minimap", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const fullBtn = button(group3, "pxd-toolbar__fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  const badge = el("span", "pxd-badge", toolbar, version ? `v${version}` : "");
  if (setting("show-version-badge") === false) badge.style.display = "none";
  const sync = el("span", "pxd-sync", toolbar);
  sync.title = "Synced";
  const toolbarApi = {
    el: toolbar,
    setCrumbs: renderCrumbs,
    setTool(tool, locked) {
      for (const [id, b] of toolButtons) {
        b.classList.toggle("pxd-tool--active", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
    },
    setZoom(z) {
      zoomLabel.textContent = `${Math.round((z || 1) * 100)}%`;
    },
    setLinkMode(mode) {
      linksBtn.textContent = LINK_LABELS[mode] || LINK_LABELS.all;
    },
    setSync(pending) {
      sync.classList.toggle("pxd-sync--pending", Boolean(pending));
      sync.title = pending ? "Saving…" : "Synced";
    },
    setFullscreen(on2) {
      fullBtn.textContent = on2 ? "Exit fullscreen" : "Fullscreen";
      fullBtn.classList.toggle("pxd-btn--active", Boolean(on2));
    },
    setPanel(open) {
      addBtn.classList.toggle("pxd-btn--active", Boolean(open));
    },
    setMinimap(open) {
      minimapBtn.classList.toggle("pxd-btn--active", Boolean(open));
    }
  };
  const ctx = el("div", "pxd-ctx pxd-chrome", root);
  ctx.style.display = "none";
  stopAll(ctx);
  let ctxAnchor = null;
  const buildCtx = (kind, model) => {
    ctx.replaceChildren();
    ctx.dataset.kind = kind;
    ctx.setAttribute("data-kind", kind);
    const row = el("div", "pxd-ctx__row", ctx);
    const btn = (cls, label, title, fn) => button(row, `pxd-ctx__btn ${cls}`, label, title, fn);
    const seg = (cls, options, current, fn) => {
      const wrap = el("div", `pxd-seg ${cls}`, row);
      for (const [value, label, title] of options) {
        const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}`, label, title || label, () => fn(value));
        b.dataset.value = String(value);
      }
      return wrap;
    };
    switch (kind) {
      case "card":
      case "cards": {
        swatches(row, (c) => on.setColor?.(c));
        if (kind === "card") {
          btn("pxd-ctx__edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "Related…", "Show related pages and blocks", () => on.related?.());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left"], ["center", "C", "Align centers"], ["right", "R", "Align right"], ["top", "T", "Align top"], ["middle", "M", "Align middles"], ["bottom", "B", "Align bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally"], ["v", "V", "Distribute vertically"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
        }
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      }
      case "board":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__open-board", "Open", "Open this board (Enter)", () => on.openBoard?.());
        if (model?.enhanced) btn("pxd-ctx__rename-board", "Rename board", "Rename the board", () => on.renameBoard?.());
        btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "section":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__rename", "Rename", "Rename (Enter)", () => on.rename?.());
        btn("pxd-ctx__contents", "Select contents", "Select the section's members", () => on.selectContents?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete frame", "Delete the frame, keep the cards (Del). Shift+Del deletes contents too", () => on.delete?.());
        break;
      case "text":
        swatches(row, (c) => on.setColor?.(c));
        seg("pxd-ctx__size", FONT_SIZES.map((s, i) => [s, ["S", "M", "L", "XL"][i], `${s}px`]), model?.fontSize || 24, (v) => on.setFontSize?.(v));
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "edge":
        seg("pxd-ctx__dir", [["one", "→", "One way"], ["two", "↔", "Two way"], ["none", "—", "No arrow"]], model?.dir, (v) => on.edgeDir?.(v));
        btn("pxd-ctx__flip", "Flip", "Swap endpoints", () => on.flip?.());
        seg("pxd-ctx__route", [["curve", "Curve"], ["straight", "Straight"], ["elbow", "Elbow"]], model?.route, (v) => on.route?.(v));
        seg("pxd-ctx__dash", [["solid", "Solid"], ["dashed", "Dashed"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"]], model?.weight, (v) => on.weight?.(v));
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__label", "Label", "Edit the label", () => on.label?.());
        btn("pxd-ctx__notes", "Notes", "Open the connection block in the sidebar", () => on.notes?.());
        btn("pxd-ctx__write", "Write to graph", "Create an attribute on the source", () => on.writeToGraph?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "link": {
        const list = el("div", "pxd-ctx__sources", row);
        for (const s of model?.sources || []) {
          const b = button(list, "pxd-ctx__source", (s.string || s.uid || "").slice(0, 60), "Open in the sidebar", () => on.openSource?.(s.uid));
          b.dataset.uid = s.uid;
        }
        btn("pxd-ctx__pin", "Pin as connection", "Create a board connection from this link", () => on.pinLink?.());
        break;
      }
      default:
        break;
    }
  };
  const positionCtx = () => {
    if (ctx.style.display === "none" || !ctxAnchor) return;
    const a = ctxAnchor();
    if (!a) {
      ctx.style.display = "none";
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const W = rootRect.width || 0;
    const H = rootRect.height || 0;
    const barW = ctx.offsetWidth || 320;
    const barH = ctx.offsetHeight || 36;
    const gap = a.kind === "edge" ? CTX_EDGE_CLEARANCE : CTX_GAP;
    let top = a.rect.y - gap - barH;
    if (top < CTX_MARGIN) top = a.rect.y + a.rect.h + gap;
    if (top + barH > H - CTX_MARGIN && a.rect.y - gap - barH >= 0) top = a.rect.y - gap - barH;
    let left = a.rect.x + a.rect.w / 2 - barW / 2;
    left = Math.max(CTX_MARGIN, Math.min(left, W - barW - CTX_MARGIN));
    ctx.style.left = `${Math.round(left)}px`;
    ctx.style.top = `${Math.round(top)}px`;
    ctx.classList.toggle("pxd-ctx--below", top > a.rect.y);
  };
  const ctxApi = {
    el: ctx,
    show(kind, model, anchor) {
      buildCtx(kind, model);
      ctxAnchor = anchor;
      ctx.style.display = "";
      positionCtx();
    },
    hide() {
      ctx.style.display = "none";
      ctxAnchor = null;
      ctx.replaceChildren();
    },
    reposition: positionCtx,
    isOpen: () => ctx.style.display !== "none"
  };
  const toast = el("div", "pxd-toast pxd-chrome", root);
  toast.style.display = "none";
  stopAll(toast);
  let toastTimer = null;
  const toastApi = {
    el: toast,
    show({ message, action } = {}) {
      toast.replaceChildren();
      el("span", "pxd-toast__text", toast, message || "");
      if (action?.label) {
        button(toast, "pxd-toast__action", action.label, action.label, () => {
          action.run?.();
          toastApi.hide();
        });
      }
      toast.style.display = "";
      toastTimer?.();
      toastTimer = timers.later(() => toastApi.hide(), TOAST_MS);
    },
    hide() {
      toast.style.display = "none";
      toastTimer?.();
      toastTimer = null;
    }
  };
  const search = el("div", "pxd-search pxd-chrome", root);
  search.style.display = "none";
  stopAll(search);
  const searchInput = el("input", "pxd-input pxd-search__input", search);
  searchInput.type = "text";
  searchInput.placeholder = "Search this board…";
  searchInput.setAttribute("placeholder", "Search this board…");
  const searchCount = el("span", "pxd-search__count", search, "");
  listen(searchInput, "input", () => {
    const n = on.searchFilter?.(searchInput.value || "") ?? 0;
    searchCount.textContent = searchInput.value ? `${n}` : "";
  });
  listen(searchInput, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      on.searchNext?.(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchApi.close();
    }
  });
  const searchApi = {
    el: search,
    open() {
      search.style.display = "";
      try {
        searchInput.focus({ preventScroll: true });
      } catch {
        searchInput.focus?.();
      }
      searchInput.select?.();
    },
    close() {
      search.style.display = "none";
      searchInput.value = "";
      searchCount.textContent = "";
      on.searchFilter?.("");
      on.searchClosed?.();
    },
    isOpen: () => search.style.display !== "none"
  };
  const minimap = el("div", "pxd-minimap pxd-chrome", root);
  stopAll(minimap);
  const canvas = el("canvas", "pxd-minimap__canvas", minimap);
  canvas.width = MINIMAP_W;
  canvas.height = MINIMAP_H;
  let mmDirty = true;
  let mmFrame = null;
  let mmState = null;
  let mmScale = null;
  const computeScale = (rects, size, vp) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (r) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    };
    for (const r of rects.values()) add(r);
    const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.width / vp.zoom, h: size.height / vp.zoom };
    add(view);
    if (!Number.isFinite(minX)) return null;
    const pad = 40;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const s = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
    return { s, ox: (MINIMAP_W - (maxX - minX) * s) / 2 - minX * s, oy: (MINIMAP_H - (maxY - minY) * s) / 2 - minY * s, view };
  };
  const draw = () => {
    mmFrame = null;
    if (!mmDirty || !mmState || minimap.style.display === "none") return;
    mmDirty = false;
    const { board, rects, vp, size } = mmState;
    const g = canvas.getContext?.("2d");
    if (!g) return;
    const sc = computeScale(rects, size, vp);
    mmScale = sc;
    g.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!sc) return;
    const colors = mmColors();
    for (const uid of board.order) {
      const item = board.items.get(uid);
      const r = rects.get(uid);
      if (!r) continue;
      g.fillStyle = item.type === "section" ? colors.section : colors.item;
      g.fillRect(r.x * sc.s + sc.ox, r.y * sc.s + sc.oy, Math.max(1, r.w * sc.s), Math.max(1, r.h * sc.s));
    }
    g.strokeStyle = colors.frame;
    g.lineWidth = 1;
    g.strokeRect(sc.view.x * sc.s + sc.ox, sc.view.y * sc.s + sc.oy, sc.view.w * sc.s, sc.view.h * sc.s);
  };
  const mmColors = () => {
    const dark = root.classList.contains("pxd-root--dark");
    return dark ? { item: "rgba(200, 210, 220, 0.6)", section: "rgba(120, 140, 160, 0.35)", frame: "#2dd4bf" } : { item: "rgba(60, 80, 100, 0.55)", section: "rgba(60, 80, 100, 0.2)", frame: "#0d9488" };
  };
  const navigateTo = (event) => {
    if (!mmScale || !mmState) return;
    const r = canvas.getBoundingClientRect();
    const px = event.clientX - r.left - mmScale.ox;
    const py = event.clientY - r.top - mmScale.oy;
    const world = { x: px / mmScale.s, y: py / mmScale.s };
    on.navigate?.(world);
  };
  let mmDragging = false;
  listen(canvas, "pointerdown", (event) => {
    event.stopPropagation();
    mmDragging = true;
    navigateTo(event);
  });
  listen(canvas, "pointermove", (event) => {
    if (mmDragging) navigateTo(event);
  });
  const stopDrag = () => {
    mmDragging = false;
  };
  listen(canvas, "pointerup", stopDrag);
  listen(canvas, "pointerleave", stopDrag);
  const minimapApi = {
    el: minimap,
    // Called from inside the view's render frame: draw now, no extra rAF.
    update(state) {
      mmState = state;
      mmDirty = true;
      if (minimap.style.display !== "none") draw();
    },
    setVisible(on2) {
      minimap.style.display = on2 ? "" : "none";
      toolbarApi.setMinimap(on2);
      if (on2) {
        mmDirty = true;
        if (!mmFrame) mmFrame = timers.frame(draw);
      }
    },
    isVisible: () => minimap.style.display !== "none",
    draw
  };
  const dispose = () => {
    toastTimer?.();
    mmFrame?.();
    listeners2.splice(0).forEach((off) => off());
    for (const node of [toolbar, ctx, toast, search, minimap]) node.remove();
  };
  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, badge, sync, dispose };
}

// src/view/panel.js
var CARD_MIME = "application/x-plexus-card";
var DEBOUNCE_MS = 150;
var LIMIT = 40;
var MAX_DROP = 50;
function parseDropPayload(dataTransfer, { resolveUid } = {}) {
  if (!dataTransfer) return [];
  const take = (type) => {
    try {
      return String(dataTransfer.getData?.(type) || "");
    } catch {
      return "";
    }
  };
  const resolve = typeof resolveUid === "function" ? resolveUid : (uid) => `((${uid}))`;
  const own = take(CARD_MIME).trim();
  if (own) return [{ string: own }];
  const tokens = (text) => text.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list"]) {
      for (const line of take(type).split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue;
        const m = line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
  }
  if (uids.length) {
    const out = [];
    for (const uid of [...new Set(uids)].slice(0, MAX_DROP)) {
      let string = null;
      try {
        string = resolve(uid);
      } catch {
        string = null;
      }
      if (typeof string === "string" && string.trim()) out.push({ string });
    }
    if (out.length) return out;
  }
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return [];
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return [{ string: `[[${page[1]}]]` }];
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return [{ string: `((${blockRef[1]}))` }];
  const plain = take("text/plain").trim();
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    let string = null;
    try {
      string = resolve(plain);
    } catch {
      string = null;
    }
    if (typeof string === "string" && string.trim()) return [{ string }];
  }
  return [];
}
function createPanel({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
  const listeners2 = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    listeners2.push(() => el2.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const panel = el("aside", "pxd-panel pxd-chrome", root);
  panel.style.display = "none";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => event.stopPropagation());
  }
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabSearch = el("button", "pxd-btn pxd-panel__tab pxd-panel__tab--on", tabs, "Search");
  const tabRelated = el("button", "pxd-btn pxd-panel__tab", tabs, "Related");
  tabSearch.type = "button";
  tabRelated.type = "button";
  const closeBtn = el("button", "pxd-btn pxd-panel__close", head, "×");
  closeBtn.type = "button";
  closeBtn.title = "Close";
  const searchPane = el("div", "pxd-panel__pane pxd-panel__pane--search", panel);
  const relatedPane = el("div", "pxd-panel__pane pxd-panel__pane--related", panel);
  relatedPane.style.display = "none";
  const input = el("input", "pxd-input pxd-panel__input", searchPane);
  input.type = "text";
  input.placeholder = "Search pages and blocks…";
  input.setAttribute("placeholder", "Search pages and blocks…");
  const results = el("div", "pxd-panel__list", searchPane);
  const relatedHead = el("div", "pxd-panel__related-head", relatedPane);
  const relatedTitle = el("span", "pxd-panel__related-title", relatedHead, "Select a card");
  const addAll = el("button", "pxd-btn pxd-panel__add-all", relatedHead, "Add all");
  addAll.type = "button";
  addAll.style.display = "none";
  const relatedList = el("div", "pxd-panel__list", relatedPane);
  let tab = "search";
  let debounce = null;
  let selected = null;
  let relatedRows = [];
  let queryId = 0;
  const row = (parent, { string, label, text, kind }) => {
    const r = el("div", "pxd-panel__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    if (label) el("span", "pxd-panel__row-label", r, label);
    el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, r, text);
    if (on.isOnBoard?.(string)) {
      r.classList.add("pxd-panel__row--on");
      el("span", "pxd-panel__row-on", r, "on board");
    }
    listen(r, "click", (event) => {
      event.stopPropagation();
      on.addBeside?.(string);
      r.classList.add("pxd-panel__row--on");
    });
    listen(r, "dragstart", (event) => {
      try {
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch {
      }
    });
    return r;
  };
  const runSearch = async () => {
    const q = String(input.value || "").trim();
    const id = queryId += 1;
    results.replaceChildren();
    if (!q) return;
    let pages = [];
    let blocks = [];
    try {
      [pages, blocks] = await Promise.all([
        Promise.resolve(host?.searchPages?.(q, LIMIT) || []),
        Promise.resolve(host?.searchBlocks?.(q, LIMIT) || [])
      ]);
    } catch {
    }
    if (id !== queryId) return;
    const rows = [
      ...pages.map((p) => ({ string: `[[${p.title}]]`, text: p.title, kind: "page", label: "page" })),
      ...blocks.map((b) => ({ string: `((${b.uid}))`, text: `${b.string || ""}`.slice(0, 120), kind: "block", label: b.pageTitle ? `in ${b.pageTitle}` : "block" }))
    ].slice(0, LIMIT);
    results.replaceChildren();
    if (!rows.length) {
      el("div", "pxd-panel__empty", results, "No matches");
      return;
    }
    rows.forEach((r) => row(results, r));
  };
  listen(input, "input", () => {
    debounce?.();
    debounce = timers.later(() => {
      debounce = null;
      void runSearch();
    }, DEBOUNCE_MS);
  });
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      debounce?.();
      debounce = null;
      void runSearch();
    }
  });
  const setTab = (next) => {
    tab = next;
    tabSearch.classList.toggle("pxd-panel__tab--on", tab === "search");
    tabRelated.classList.toggle("pxd-panel__tab--on", tab === "related");
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    if (tab === "related") void loadRelated();
  };
  listen(tabSearch, "click", () => setTab("search"));
  listen(tabRelated, "click", () => setTab("related"));
  listen(closeBtn, "click", () => api.close());
  listen(addAll, "click", () => {
    const strings = relatedRows.map((r) => r.string).filter((s) => !on.isOnBoard?.(s));
    if (strings.length) on.addMany?.(strings);
  });
  const loadRelated = async () => {
    relatedList.replaceChildren();
    relatedRows = [];
    addAll.style.display = "none";
    if (!selected || !host?.related) {
      relatedTitle.textContent = "Select a card";
      return;
    }
    const target = selected.target;
    const key = target.kind === "page" ? { kind: "page", title: target.title } : { kind: "block", uid: target.uid };
    relatedTitle.textContent = selected.title || "Related";
    const id = queryId += 1;
    let list = [];
    try {
      list = await Promise.resolve(host.related(key, 60, { boardUid: root?.dataset?.board })) || [];
    } catch {
      list = [];
    }
    if (id !== queryId || tab !== "related") return;
    relatedList.replaceChildren();
    for (const rel of list) {
      const t = rel.target || {};
      const string = t.kind === "page" ? `[[${t.title}]]` : `((${t.uid}))`;
      const text = rel.text || (t.kind === "page" ? t.title : t.uid) || "";
      relatedRows.push({ string });
      row(relatedList, { string, label: rel.relation || "related", text, kind: t.kind });
    }
    if (!list.length) el("div", "pxd-panel__empty", relatedList, "Nothing related yet");
    addAll.style.display = list.length ? "" : "none";
  };
  const api = {
    el: panel,
    open(which = tab) {
      panel.style.display = "";
      setTab(which);
      on.opened?.(true);
      if (which === "search") {
        try {
          input.focus({ preventScroll: true });
        } catch {
          input.focus?.();
        }
      }
    },
    close() {
      panel.style.display = "none";
      on.opened?.(false);
    },
    toggle() {
      if (api.isOpen()) api.close();
      else api.open();
    },
    isOpen: () => panel.style.display !== "none",
    setSelection(item) {
      selected = item && item.type !== "section" ? item : null;
      if (api.isOpen() && tab === "related") void loadRelated();
    },
    refreshMarks() {
      for (const r of panel.querySelectorAll(".pxd-panel__row")) {
        const s = r.dataset?.string || r.getAttribute("data-string");
        r.classList.toggle("pxd-panel__row--on", Boolean(on.isOnBoard?.(s)));
      }
    },
    dispose() {
      debounce?.();
      queryId += 1;
      listeners2.splice(0).forEach((off) => off());
      panel.remove();
    }
  };
  return api;
}

// src/discovery.js
var DIAGRAM_MARKER = /\{\{\s*(\[\[)?diagram/i;
var MAX_GUARD_UIDS = 2e3;
var ENHANCED_UID_CACHE_PREFIX = "plexus-diagram:enhanced-uids:";
var PREPAINT_STYLE_ID = "plexus-diagram-prepaint-guard";
var PENDING_CLASS = "pxd-native-pending";
var NATIVE_HIDDEN_CLASS = "pxd-native-hidden";
var OUTLINE_NATIVE_CLASS = "pxd-outline-native";
function isDiagramString(value) {
  return DIAGRAM_MARKER.test(String(value ?? ""));
}
function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function graphCacheKey(locationHash = globalThis.location?.hash || "") {
  const match = String(locationHash).match(/#\/app\/([^/]+)/);
  return match ? `${ENHANCED_UID_CACHE_PREFIX}${match[1]}` : `${ENHANCED_UID_CACHE_PREFIX}unknown`;
}
function diagramUidFromLocation(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/[^/]+\/page\/([^/?#]+)/);
  return match ? match[1] : null;
}
function routeLeftZoomedDiagram(diagramUid, hash = globalThis.location?.hash || "") {
  if (!diagramUid) return true;
  return diagramUidFromLocation(hash) !== diagramUid;
}
function readEnhancedUidCache(storage = globalThis.localStorage, key = graphCacheKey()) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return /* @__PURE__ */ new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return /* @__PURE__ */ new Set();
    return new Set(parsed.map(String).filter(Boolean).sort());
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function writeEnhancedUidCache(uids, storage = globalThis.localStorage, key = graphCacheKey()) {
  const sorted = [...new Set([...uids].map(String).filter(Boolean))].sort();
  storage?.setItem?.(key, JSON.stringify(sorted));
  return sorted;
}
function enhancedUidGuardCss(uids) {
  const selectors = [];
  const unique = [...new Set([...uids].map(String).filter(Boolean))].sort();
  if (unique.length > MAX_GUARD_UIDS) {
    console.warn(`[plexus-diagram] Skipping the pre-paint guard: ${unique.length} cached diagram uids exceeds the ${MAX_GUARD_UIDS} cap`);
    return "";
  }
  for (const uid of unique) {
    const escaped = cssAttributeValue(uid);
    for (const host of [
      `[id$="${escaped}"]`,
      `[data-uid="${escaped}"]`,
      `.rm-block-ref[data-uid="${escaped}"]`
    ]) {
      selectors.push(
        `${host} .rm-diagram:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .rm-diagram-title-panel:not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .react-flow:not(.${OUTLINE_NATIVE_CLASS} *)`
      );
    }
  }
  const hideRule = selectors.length ? `${selectors.join(",\n")} { display: none !important; }` : "";
  const pendingRule = unique.length ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS}) { visibility: hidden !important; pointer-events: none !important; }` : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}
function uidFromBlockInputId(id, isDiagramUid) {
  const value = String(id || "");
  const prefix = "block-input-";
  if (!value.startsWith(prefix) || typeof isDiagramUid !== "function") return null;
  for (let i = value.length - 1; i >= prefix.length; i -= 1) {
    if (value[i] !== "-") continue;
    const candidate = value.slice(i + 1);
    if (candidate && isDiagramUid(candidate)) return candidate;
  }
  return null;
}
var BLOCK_CONTAINER_SELECTOR = ".roam-block-container";
function directChildWithClass(element, className) {
  for (const child of element?.children || []) {
    if (child.classList?.contains(className)) return child;
  }
  return null;
}
function blockContainerUid(container, isDiagramUid) {
  const main = directChildWithClass(container, "rm-block-main");
  const input = main?.querySelector?.('[id^="block-input-"]');
  return uidFromBlockInputId(input?.id, isDiagramUid);
}
function findDiagramUidFromEl(element, isDiagramUid) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  const resolved = uidFromBlockInputId(blockInput?.id, isDiagramUid);
  if (resolved) return resolved;
  if (blockInput?.id) {
    const dated = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (dated) return dated[1];
    const zoomed = blockInput.id.match(/block-input-.+-body-outline-(.+)$/);
    if (zoomed && !/^\d{2}-\d{2}-\d{4}(-|$)/.test(zoomed[1])) return zoomed[1];
  }
  if (element.closest?.(".rm-zoom-block-wrapper")) {
    const pageUid = diagramUidFromLocation();
    if (pageUid) return pageUid;
  }
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  return null;
}
function diagramsWithin(root) {
  if (!root) return [];
  const values = [];
  if (root.matches?.(".rm-diagram")) values.push(root);
  for (const diagram of root.querySelectorAll?.(".rm-diagram") || []) {
    if (!values.includes(diagram)) values.push(diagram);
  }
  return values;
}
function isEnhancedProps(pulledProps) {
  return readPlexus(pulledProps)?.v === SCHEMA_VERSION;
}
function readEnhanced(api, uid) {
  if (!uid) return false;
  try {
    const pulled = api?.data?.pull?.("[:block/props]", [":block/uid", uid]);
    return isEnhancedProps(pulled?.[":block/props"] ?? pulled?.props ?? null);
  } catch {
    return false;
  }
}

// src/view/fullscreen.js
var SIDEBAR_SELECTORS = [".roam-sidebar-container", ".rm-left-sidebar", "#roam-sidebar-container"];
var RIGHT_SIDEBAR_SELECTORS = ["#right-sidebar", ".rm-right-sidebar", '[class*="right-sidebar"]'];
var RIGHT_INSET_COLLAPSE_PX = 8;
function raf(callback) {
  const fn = globalThis.requestAnimationFrame;
  if (typeof fn === "function") {
    const id2 = fn(callback);
    return () => globalThis.cancelAnimationFrame?.(id2);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}
function firstMatch(root, selectors) {
  if (!root?.querySelector) return null;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}
function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}
function fullscreenInsets(root = globalThis.document) {
  const topbarBottom = topbarOffset(root);
  const article = root?.querySelector?.(".rm-article-wrapper");
  if (!article?.getBoundingClientRect) return { top: topbarBottom, left: 0, right: 0, bottom: 0 };
  const rect = article.getBoundingClientRect();
  const top = Math.max(Number(rect.top) || 0, topbarBottom);
  const left = Number.isFinite(Number(rect.left)) ? Math.round(rect.left) : 0;
  const view = root.defaultView || globalThis;
  const vw = Number(view.innerWidth);
  const vh = Number(view.innerHeight);
  let right = 0;
  if (Number.isFinite(Number(rect.right)) && Number.isFinite(vw) && vw > 0) {
    const gap = vw - rect.right;
    right = gap <= RIGHT_INSET_COLLAPSE_PX ? 0 : Math.max(0, Math.round(gap));
  }
  let bottom = 0;
  if (Number.isFinite(Number(rect.bottom)) && Number.isFinite(vh) && vh > 0) bottom = Math.max(0, Math.round(vh - rect.bottom));
  return { top: Math.round(top), left, right, bottom };
}
function applyFullscreenChrome(mount, on, root = globalThis.document) {
  mount?.classList?.toggle?.("pxd-mount--fullscreen", Boolean(on));
  root?.body?.classList?.toggle?.("pxd-has-fullscreen", Boolean(on));
  if (!on) {
    if (mount?.style) {
      for (const k of ["top", "left", "right", "bottom", "width", "height", "minHeight"]) mount.style[k] = "";
    }
    return () => {
    };
  }
  let alive = true;
  const place = () => {
    if (!alive || !mount?.style) return;
    const box = fullscreenInsets(root);
    mount.style.top = `${box.top}px`;
    mount.style.left = `${box.left}px`;
    mount.style.right = `${box.right}px`;
    mount.style.bottom = `${box.bottom}px`;
    mount.style.width = "auto";
    mount.style.height = "auto";
    mount.style.minHeight = "0";
  };
  const placeAfterAnim = () => {
    place();
    raf(() => {
      place();
      raf(place);
    });
  };
  place();
  const disconnects = [];
  const article = root?.querySelector?.(".rm-article-wrapper");
  const sidebar = firstMatch(root, SIDEBAR_SELECTORS);
  const rightSidebar = firstMatch(root, RIGHT_SIDEBAR_SELECTORS);
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => place());
      if (article) ro.observe(article);
      if (sidebar) ro.observe(sidebar);
      if (rightSidebar && rightSidebar !== sidebar && rightSidebar !== article) ro.observe(rightSidebar);
      disconnects.push(() => ro.disconnect());
    } catch {
    }
  }
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function" && article) {
    try {
      const mo = new MO(() => placeAfterAnim());
      mo.observe(article, { attributes: true, attributeFilter: ["class"] });
      disconnects.push(() => mo.disconnect());
    } catch {
    }
  }
  const cancel = raf(place);
  return () => {
    alive = false;
    cancel();
    disconnects.forEach((d) => d());
  };
}
function watchRouteExit({ boardUid, onExit, win = globalThis.window } = {}) {
  if (!win?.addEventListener) return () => {
  };
  const check = () => {
    const hash = win.location?.hash || "";
    if (routeLeftZoomedDiagram(boardUid, hash)) onExit?.();
  };
  win.addEventListener("hashchange", check);
  win.addEventListener("popstate", check);
  return () => {
    win.removeEventListener("hashchange", check);
    win.removeEventListener("popstate", check);
  };
}

// src/view/board-view.js
var SVG_NS2 = "http://www.w3.org/2000/svg";
var DEFAULT_HEIGHT = 560;
var MIN_HEIGHT = 240;
var RESUME_MS = 120;
var VP_PERSIST_MS = 500;
var CULL_MARGIN = 0.5;
function createTimers() {
  const active = /* @__PURE__ */ new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      active.delete(entry);
      fn();
    }, ms);
    const entry = () => {
      clearTimeout(id);
      active.delete(entry);
    };
    active.add(entry);
    return entry;
  };
  const frame = (fn) => {
    const raf2 = globalThis.requestAnimationFrame;
    let entry;
    if (typeof raf2 === "function") {
      const id = raf2((t) => {
        active.delete(entry);
        fn(t);
      });
      entry = () => {
        globalThis.cancelAnimationFrame?.(id);
        active.delete(entry);
      };
    } else {
      const id = setTimeout(() => {
        active.delete(entry);
        fn(Date.now());
      }, 16);
      entry = () => {
        clearTimeout(id);
        active.delete(entry);
      };
    }
    active.add(entry);
    return entry;
  };
  const idle = (fn) => {
    const ric = globalThis.requestIdleCallback;
    let entry;
    if (typeof ric === "function") {
      const id = ric((d) => {
        active.delete(entry);
        fn(d);
      });
      entry = () => {
        globalThis.cancelIdleCallback?.(id);
        active.delete(entry);
      };
    } else {
      const id = setTimeout(() => {
        active.delete(entry);
        fn({ timeRemaining: () => 8, didTimeout: true });
      }, 0);
      entry = () => {
        clearTimeout(id);
        active.delete(entry);
      };
    }
    active.add(entry);
    return entry;
  };
  return { later, frame, idle, count: () => active.size, cancelAll: () => {
    for (const c of [...active]) c();
    active.clear();
  } };
}
function isDarkHost(root, doc = globalThis.document) {
  const has = (el, name) => Boolean(el?.classList?.contains?.(name));
  let node = root;
  while (node) {
    if (has(node, "bp3-dark") || has(node, "rm-dark-theme") || has(node, "bt-theme-dark")) return true;
    if (has(node, "roam-body") && has(node, "dark")) return true;
    node = node.parentElement;
  }
  const body = doc?.body;
  const html = doc?.documentElement;
  if (has(html, "bp3-dark") || has(body, "bt-theme-dark") || has(body, "bp3-dark") || has(body, "rm-dark-theme")) return true;
  if (has(body, "roam-body") && has(body, "dark")) return true;
  return false;
}
function graphName2(win = globalThis.window) {
  const m = /#\/app\/([^/]+)/.exec(String(win?.location?.hash || ""));
  return m ? decodeURIComponent(m[1]) : "graph";
}
function createLocalViewportStore({ storage, graph, timers }) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const pending = /* @__PURE__ */ new Map();
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch {
        return null;
      }
    },
    set(uid, vp) {
      if (!storage?.setItem) return;
      const write = () => {
        pending.delete(uid);
        try {
          storage.setItem(key(uid), JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom }));
        } catch {
        }
      };
      if (pending.has(uid)) {
        pending.get(uid).vp = vp;
        return;
      }
      const entry = { vp, cancel: timers.later(() => write(), VP_PERSIST_MS) };
      pending.set(uid, entry);
    },
    flush() {
      for (const [uid, e] of pending) {
        e.cancel();
        try {
          storage?.setItem?.(key(uid), JSON.stringify(e.vp));
        } catch {
        }
      }
      pending.clear();
    }
  };
}
function mountBoardView({
  host,
  session,
  mountEl,
  nativeEl = null,
  settings,
  onRequestFullscreen,
  fullscreen = false,
  version = "",
  crumbs = null,
  onOpenBoard = null,
  onCrumb = null,
  routeUid = session.uid,
  autofocus = false
} = {}) {
  const doc = globalThis.document;
  const win = globalThis.window;
  const setting = (k, d) => {
    const v = typeof settings?.get === "function" ? settings.get(k) : settings?.[k];
    return v === void 0 || v === null ? d : v;
  };
  const timers = createTimers();
  const listeners2 = [];
  const observers = [];
  const subs = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    const off = () => el2.removeEventListener(type, fn, opts);
    listeners2.push(off);
    return off;
  };
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const svg = (cls, parent) => {
    const node = doc.createElementNS(SVG_NS2, "svg");
    node.setAttribute("class", cls);
    if (node.classList && !node.classList.contains(cls)) node.className = cls;
    parent?.append(node);
    return node;
  };
  const boardUid = session.uid;
  const graph = host?.graph || graphName2(win);
  const storage = globalThis.localStorage;
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;
  const root = el("div", "pxd-root", mountEl);
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
  root.dataset.tool = "select";
  root.setAttribute("data-tool", "select");
  root.dataset.board = boardUid;
  const viewport = el("div", "pxd-viewport", root);
  const grid = el("div", "pxd-grid", viewport);
  const world = el("div", "pxd-world", viewport);
  const sectionsLayer = el("div", "pxd-sections", world);
  const edgesSvg = svg("pxd-edges", world);
  const labelsLayer = el("div", "pxd-labels", world);
  const itemsLayer = el("div", "pxd-items", world);
  const overlaySvg = svg("pxd-overlay", world);
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  if (isDarkHost(mountEl, doc)) root.classList.add("pxd-root--dark");
  let vp = vpStore.get(boardUid);
  let size = { width: 0, height: 0 };
  let rootRect = { left: 0, top: 0, width: 0, height: 0 };
  let disposed = false;
  let released = false;
  let gesturing = false;
  let isFullscreen = false;
  let pointerInside = Boolean(mountEl?.matches?.(":hover"));
  let suppressClick = false;
  let swallowMouseUp = false;
  let linkMode = setting("graph-links", "all");
  let selection = { items: [], edge: null, link: null };
  let liveRects = null;
  let resumeTimer = null;
  let settleTimer = null;
  let searchMatches = [];
  let searchIndex = -1;
  let frameHandle = null;
  let fsDispose = () => {
  };
  let routeOff = () => {
  };
  const dirty = { viewport: false, items: /* @__PURE__ */ new Set(), edges: /* @__PURE__ */ new Set(), structural: false, all: true, selection: false, links: false, ctx: false };
  const board = () => session.board;
  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };
  const measure = () => {
    const r = root.getBoundingClientRect();
    rootRect = { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
    size = { width: rootRect.width, height: rootRect.height };
  };
  const itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers,
    onEditChange: (uid) => {
      root.classList.toggle("pxd-root--editing", Boolean(uid));
    },
    onOpenBoard: (uid) => {
      void openBoard(uid);
    },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title)
  });
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label })
  });
  const schedule = () => {
    if (disposed || frameHandle) return;
    frameHandle = timers.frame(() => {
      frameHandle = null;
      renderFrame();
    });
  };
  const markViewport = () => {
    dirty.viewport = true;
    schedule();
  };
  const markAll = () => {
    dirty.all = true;
    dirty.structural = true;
    schedule();
  };
  const setViewport = (next) => {
    if (!next) return;
    vp = { x: next.x, y: next.y, zoom: next.zoom };
    markViewport();
    if (!gesturing) settle();
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    setViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5 }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    setViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };
  const applyLod = () => {
    const z = vp.zoom;
    const lod = lodForZoom(z);
    root.classList.toggle("pxd-lod-map", lod === "map");
    root.style.setProperty("--pxd-map-font", `${Math.min(42, Math.max(14, 13 / z))}px`);
    root.style.setProperty("--pxd-ui", String(Math.min(4, Math.max(1, 1 / z))));
    itemsR.setLod(lod, z);
  };
  const scheduleContent = () => {
    if (disposed || gesturing || !board()) return;
    itemsR.scheduleContent({ visibleRect: visibleWorldRect(vp, size, CULL_MARGIN), zoom: vp.zoom });
  };
  const settle = () => {
    settleTimer?.();
    settleTimer = timers.later(() => {
      settleTimer = null;
      if (gesturing) return;
      applyLod();
      scheduleContent();
      vpStore.set(boardUid, vp);
      dirty.edges = new Set(board()?.edges.keys() || []);
      dirty.links = true;
      schedule();
    }, RESUME_MS);
  };
  const selectedItems = () => selection.items.map((u) => board()?.items.get(u)).filter(Boolean);
  const toScreenRect = (r) => {
    const p = worldToScreen(vp, { x: r.x, y: r.y });
    return { x: p.x, y: p.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
  };
  const pathScreenRect = (geo, extra) => {
    const pts = [geo.start, geo.end, geo.mid].filter(Boolean).map((p) => worldToScreen(vp, p));
    for (const r of extra) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    const xs2 = pts.map((p) => p.x);
    const ys2 = pts.map((p) => p.y);
    const x = Math.min(...xs2);
    const y = Math.min(...ys2);
    return { x, y, w: Math.max(...xs2) - x, h: Math.max(...ys2) - y };
  };
  const ctxAnchor = () => {
    const b = board();
    if (!b) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      const geo = edgesR.geometryOf(selection.edge);
      if (!edge || !geo) return null;
      const lr = edge.label ? edgesR.labelRect(selection.edge) : null;
      const extra = lr && lr.width ? [{ x: lr.left - rootRect.left, y: lr.top - rootRect.top, w: lr.width, h: lr.height }] : [];
      return { kind: "edge", rect: pathScreenRect(geo, extra) };
    }
    if (selection.link) {
      const geo = edgesR.linkGeometryOf(selection.link);
      if (!geo) return null;
      return { kind: "edge", rect: pathScreenRect(geo, []) };
    }
    const r = rects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const showCtx = () => {
    const b = board();
    if (!b) return chrome.ctx.hide();
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      return edge ? chrome.ctx.show("edge", edge, ctxAnchor) : chrome.ctx.hide();
    }
    if (selection.link) {
      const link = (session.links || []).find((l) => l.key === selection.link);
      return link ? chrome.ctx.show("link", link, ctxAnchor) : chrome.ctx.hide();
    }
    const items = selectedItems();
    if (!items.length) return chrome.ctx.hide();
    if (items.length > 1) return chrome.ctx.show("cards", null, ctxAnchor);
    const it = items[0];
    return chrome.ctx.show(it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card", it, ctxAnchor);
  };
  const targetUids = () => selection.edge ? [selection.edge] : selection.items;
  const singleItem = () => selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null;
  const openItemInSidebar = (item) => {
    if (!item) return;
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) host?.openInSidebar?.(uid, "outline");
    } else {
      host?.openInSidebar?.(item.target.uid || item.uid, "block");
    }
  };
  const stackAt = (strings, x, y, h) => strings.map((string, i) => ({ string, x, y: y + i * (h + 24) }));
  const addStringsBeside = (strings) => {
    const b = board();
    if (!b || !strings.length) return;
    const r = rects();
    const sel = singleItem();
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    let x;
    let y;
    if (sel && r.get(sel.uid)) {
      const sr = r.get(sel.uid);
      x = sr.x + sr.w + 40;
      y = sr.y;
    } else {
      const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
      x = c.x - w / 2;
      y = c.y - h / 2;
    }
    void session.addRefCards?.(stackAt(strings, x, y, h));
  };
  const isOnBoard = (string) => {
    const b = board();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  const openBoard = async (uid) => {
    const item = board()?.items.get(uid);
    if (!item || item.kind !== "board") return;
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    if (onOpenBoard) onOpenBoard(uid);
    else host?.openBlock?.(uid);
  };
  const goCrumb = async (index) => {
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    onCrumb?.(index);
  };
  const popBoard = () => {
    if (crumbList.length > 1 && onCrumb) {
      void goCrumb(crumbList.length - 2);
      return true;
    }
    return false;
  };
  const chrome = createChrome({
    doc,
    root,
    version,
    settings,
    timers,
    crumbs: crumbList,
    on: {
      openBoard: () => {
        const it = singleItem();
        if (it) void openBoard(it.uid);
      },
      renameBoard: () => {
        const it = singleItem();
        if (it) itemsR.renameBoard(it.uid);
      },
      crumb: (index) => {
        void goCrumb(index);
      },
      wrapBoard: () => {
        if (!selection.items.length) return;
        Promise.resolve(session.wrapInBoard?.(selection.items)).then((uid) => {
          if (uid) ctl.select([uid]);
        }).catch(() => {
        });
      },
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      cycleLinks: () => cycleLinks(),
      zoomIn: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      setColor: (c) => {
        const uids = targetUids();
        if (uids.length) void session.setColor?.(uids, c);
      },
      edit: () => {
        const it = singleItem();
        if (it) void enterEdit(it.uid);
      },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => {
        const it = singleItem();
        if (it) void session.setCollapsed?.(it.uid, !it.collapsed);
      },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => {
        const it = singleItem();
        if (it) itemsR.renameSection(it.uid);
      },
      selectContents: () => {
        const it = singleItem();
        if (it?.members?.length) ctl.select(it.members);
      },
      setFontSize: (n) => {
        const it = singleItem();
        if (it) void session.setFontSize?.(it.uid, n);
      },
      edgeDir: (dir) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dir });
      },
      flip: () => {
        if (selection.edge) void session.flipEdge?.(selection.edge);
      },
      route: (route) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { route });
      },
      dash: (dash) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dash });
      },
      weight: (weight) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { weight });
      },
      label: () => {
        if (selection.edge) edgesR.editLabel(selection.edge);
      },
      notes: () => {
        if (selection.edge) host?.openInSidebar?.(selection.edge, "block");
      },
      writeToGraph: async () => {
        if (!selection.edge) return;
        const r = await session.writeToGraph?.(selection.edge);
        chrome.toast.show({ message: r?.ok ? "Written to the graph" : `Not written: ${r?.reason || "unknown"}` });
      },
      pinLink: () => {
        const link = (session.links || []).find((l) => l.key === selection.link);
        if (link) Promise.resolve(session.pinLink?.(link)).then((uid) => {
          if (uid) ctl.selectEdge(uid);
        }).catch(() => {
        });
      },
      openSource: (uid) => host?.openInSidebar?.(uid, "block"),
      align: (mode) => {
        const r = rects();
        const list = selection.items.map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
        const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
        void session.commitRects?.(moved);
      },
      distribute: (axis) => {
        const r = rects();
        const list = selection.items.map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
        const moved = distributeRects(list, axis).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
        void session.commitRects?.(moved);
      },
      wrap: () => {
        if (selection.items.length) void session.wrapInSection?.(selection.items);
      },
      navigate: (worldPoint) => centerOn(worldPoint),
      searchFilter: (text) => searchFilter(text),
      searchNext: (dir) => searchNext(dir),
      searchClosed: () => {
        try {
          root.focus({ preventScroll: true });
        } catch {
        }
      }
    }
  });
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    on: {
      addBeside: (string) => addStringsBeside([string]),
      addMany: (strings) => addStringsBeside(strings),
      isOnBoard,
      opened: (open) => chrome.toolbar.setPanel(open)
    }
  });
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);
  grid.className = `pxd-grid pxd-grid--${setting("grid", "dots")}`;
  const cycleLinks = () => {
    linkMode = LINK_MODES2[(LINK_MODES2.indexOf(linkMode) + 1) % LINK_MODES2.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchMatches = [];
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    if (!b) return 0;
    for (const item of b.items.values()) {
      const hay = `${item.title}
${plainText(item.string, 2e3)}`.toLowerCase();
      const hit = q && hay.includes(q);
      if (hit) searchMatches.push(item.uid);
      itemsR.shellOf(item.uid)?.classList.toggle("pxd-item--dim", Boolean(q) && !hit);
    }
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const uid = searchMatches[searchIndex];
    ctl.select([uid]);
    fitSelection([uid]);
  };
  const enterEdit = async (uid) => {
    ctl.select([uid]);
    if (lodForZoom(vp.zoom) === "map") {
      fitSelection([uid]);
      applyLod();
    }
    const ok = await itemsR.enterEdit(uid);
    if (ok) chrome.ctx.hide();
    return ok;
  };
  const freshItems = /* @__PURE__ */ new Set();
  const exitEdit = async () => {
    const uid = itemsR.editingUid?.();
    await itemsR.exitEdit();
    if (uid && freshItems.delete(uid)) {
      const item = session.board?.items?.get(uid);
      const text = host?.blockString?.(uid);
      if (item && !String(text ?? item.string ?? "").trim() && !(item.content || []).length) {
        await session.deleteItems?.([uid]);
      }
    }
    if (!disposed) {
      dirty.selection = true;
      schedule();
    }
  };
  const applyFullscreen = (on) => {
    isFullscreen = Boolean(on);
    fsDispose();
    fsDispose = applyFullscreenChrome(mountEl, isFullscreen, doc);
    root.classList.toggle("pxd-root--fullscreen", isFullscreen);
    chrome.toolbar.setFullscreen(isFullscreen);
    resizeGrip.style.display = isFullscreen ? "none" : "";
    if (isFullscreen) {
      root.style.height = "";
    } else applyInlineHeight();
    timers.frame(() => {
      measure();
      markViewport();
    });
  };
  const requestFullscreen = (on) => {
    applyFullscreen(on);
    onRequestFullscreen?.(Boolean(on));
  };
  const readHeight = () => {
    try {
      const v = Number(storage?.getItem?.(heightKey));
      return Number.isFinite(v) && v >= MIN_HEIGHT ? v : Number(setting("default-height", DEFAULT_HEIGHT)) || DEFAULT_HEIGHT;
    } catch {
      return DEFAULT_HEIGHT;
    }
  };
  const applyInlineHeight = (h = readHeight()) => {
    root.style.height = `${h}px`;
    if (mountEl?.style) {
      mountEl.style.height = `${h}px`;
      mountEl.style.minHeight = `${h}px`;
    }
  };
  let heightDrag = null;
  const onHeightMove = (event) => {
    if (!heightDrag) return;
    const h = Math.max(MIN_HEIGHT, Math.round(heightDrag.h0 + (event.clientY - heightDrag.y0)));
    heightDrag.h = h;
    applyInlineHeight(h);
  };
  const onHeightUp = () => {
    if (!heightDrag) return;
    try {
      storage?.setItem?.(heightKey, String(heightDrag.h));
    } catch {
    }
    heightDrag = null;
    doc.removeEventListener("pointermove", onHeightMove, true);
    doc.removeEventListener("pointerup", onHeightUp, true);
    measure();
    markViewport();
  };
  listen(resizeGrip, "pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    heightDrag = { y0: event.clientY, h0: rootRect.height || readHeight(), h: rootRect.height || readHeight() };
    doc.addEventListener("pointermove", onHeightMove, true);
    doc.addEventListener("pointerup", onHeightUp, true);
  });
  const actions = {
    board,
    rects,
    viewport: () => vp,
    size: () => size,
    setViewport,
    fitAll,
    fitSelection,
    onSelection: (sel) => {
      selection = { items: sel.items || [], edge: sel.edge || null, link: sel.link || null };
      dirty.selection = true;
      panel.setSelection(singleItem());
      schedule();
    },
    onTool: (tool, locked) => {
      root.dataset.tool = tool;
      root.setAttribute("data-tool", tool);
      chrome.toolbar.setTool(tool, locked);
    },
    onHover: (uid) => itemsR.setHover(uid),
    setGesturing: (on, info) => {
      gesturing = Boolean(on);
      root.classList.toggle("pxd-root--gesturing", gesturing);
      world.style.willChange = gesturing ? "transform" : "";
      if (gesturing) {
        resumeTimer?.();
        resumeTimer = null;
        itemsR.setPaused(true);
        chrome.ctx.hide();
      } else {
        if (info?.moved) {
          suppressClick = true;
          swallowMouseUp = true;
          timers.later(() => {
            suppressClick = false;
            swallowMouseUp = false;
          }, 0);
        }
        liveRects = null;
        resumeTimer = timers.later(() => {
          resumeTimer = null;
          itemsR.setPaused(false);
          applyLod();
          scheduleContent();
          vpStore.set(boardUid, vp);
          dirty.selection = true;
          schedule();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewMove(uids, dx, dy, b, rects());
      const set = new Set(uids);
      for (const u of uids) for (const d of descendantsOf(b, u)) set.add(d);
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
    },
    previewRects: (list) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      const set = new Set(list.map((r) => r.uid));
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
    },
    showTempWire: (spec) => edgesR.setTempWire(spec, rects(), vp.zoom),
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => Promise.resolve(session.createCard?.({ x: p.x, y: p.y })).then((uid) => {
      if (uid) freshItems.add(uid);
      return uid;
    }),
    createText: (p) => Promise.resolve(session.createText?.({ x: p.x, y: p.y })).then((uid) => {
      if (uid) freshItems.add(uid);
      return uid;
    }),
    createSection: (p) => session.createSection?.({ rect: p.rect }),
    createBoard: (p) => session.createBoard?.({ rect: p.rect }),
    moveIntoBoard: async (uids, boardUid2, dx = 0, dy = 0) => {
      const res = await session.moveIntoBoard?.(uids, boardUid2);
      if (!res) {
        void session.commitMove?.(uids, dx, dy);
        return;
      }
      chrome.toast.show({ message: `Moved into ${res.title}`, action: { label: "Undo", run: () => res.undo() } });
    },
    openBoard: (uid) => openBoard(uid),
    popBoard,
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => session.deleteItems?.(uids, opts),
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => session.addEdge?.(spec),
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid) => enterEdit(uid),
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on))
  };
  const ctl = createInteractions({ actions, settings });
  ctl.setTool("select");
  const targetOf = (t) => {
    if (!t || typeof t.closest !== "function") return { kind: "empty" };
    if (t.closest(".pxd-chrome")) return { kind: "chrome" };
    const port = t.closest(".pxd-port");
    if (port) {
      const owner = port.closest(".pxd-item, .pxd-section");
      return { kind: "port", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), side: port.dataset?.side || port.getAttribute?.("data-side") };
    }
    const grip = t.closest(".pxd-grip");
    if (grip) {
      const owner = grip.closest(".pxd-item, .pxd-section");
      return { kind: "grip", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), part: grip.dataset?.part || grip.getAttribute?.("data-part") };
    }
    const label = t.closest(".pxd-label");
    if (label) {
      const key = label.dataset?.key || label.getAttribute?.("data-key");
      if (key) return { kind: "link", key };
      return { kind: "label", uid: label.dataset?.uid || label.getAttribute?.("data-uid") };
    }
    const edge = t.closest(".pxd-edge");
    if (edge) return { kind: "edge", uid: edge.dataset?.uid || edge.getAttribute?.("data-uid") };
    const link = t.closest(".pxd-link");
    if (link) return { kind: "link", key: link.dataset?.key || link.getAttribute?.("data-key") };
    const title = t.closest(".pxd-section__title");
    if (title) return { kind: "section-title", uid: title.closest(".pxd-section")?.dataset?.uid || title.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const border = t.closest(".pxd-section__edge");
    if (border) return { kind: "section-border", uid: border.closest(".pxd-section")?.dataset?.uid || border.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const item = t.closest(".pxd-item");
    if (item) return { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
    return { kind: "empty" };
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    return {
      type,
      screen,
      world: screenToWorld(vp, screen),
      target: targetOf(event.target),
      button: event.button ?? 0,
      buttons: event.buttons ?? 0,
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      ctrl: Boolean(event.ctrlKey),
      key: event.key,
      code: event.code,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      pointerId: event.pointerId
    };
  };
  let captured = false;
  const onDocMove = (event) => {
    if (ctl.isGesturing()) ctl.handle(normalize(event, "pointermove"));
  };
  const onDocUp = (event) => {
    if (!ctl.isGesturing()) return releaseCapture();
    ctl.handle(normalize(event, "pointerup"));
    releaseCapture();
  };
  const onDocCancel = () => {
    ctl.handle({ type: "pointercancel" });
    releaseCapture();
  };
  const releaseCapture = () => {
    if (!captured) return;
    captured = false;
    doc.removeEventListener("pointermove", onDocMove, true);
    doc.removeEventListener("pointerup", onDocUp, true);
    doc.removeEventListener("pointercancel", onDocCancel, true);
  };
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
    }
    ctl.handle(ev);
    if (ctl.isGesturing() && !captured) {
      captured = true;
      doc.addEventListener("pointermove", onDocMove, true);
      doc.addEventListener("pointerup", onDocUp, true);
      doc.addEventListener("pointercancel", onDocCancel, true);
    }
    try {
      if (!editingUid && ev.target.kind !== "label") root.focus({ preventScroll: true });
    } catch {
    }
  });
  listen(doc, "mouseup", (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  for (const type of ["mousedown", "mouseup"]) {
    listen(root, type, (event) => {
      if (event.target?.closest?.(".pxd-chrome")) return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing")) return;
    event.preventDefault();
  });
  listen(root, "click", (event) => {
    if (suppressClick) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (openRefFromClick(event)) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    event.preventDefault();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    const handled = ctl.handle(normalize(event, "wheel"));
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      settle();
    }
  }, { passive: false });
  listen(root, "contextmenu", (event) => {
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "pointerenter", () => {
    pointerInside = true;
  });
  listen(root, "pointerleave", () => {
    pointerInside = false;
  });
  const acceptsDrop = (event) => !event.target?.closest?.(".pxd-item__editor");
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    measure();
    const resolveUid = (u) => host?.cardStringForUid ? host.cardStringForUid(u) : `((${u}))`;
    const list = parseDropPayload(event.dataTransfer, { resolveUid });
    if (!list.length) return;
    const p = screenToWorld(vp, { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top });
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = session.addRefCards?.(stackAt(list.map((x) => x.string), p.x - w / 2, p.y - h / 2, h));
    Promise.resolve(made).then((uids) => {
      if (Array.isArray(uids) && uids.length) ctl.select(uids);
    }).catch(() => {
    });
  });
  const ownsKeyboard = () => pointerInside || isFullscreen || root.contains?.(doc.activeElement);
  const onKeyDown = (event) => {
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside2 = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside2 && !itemsR.isEditing()) return;
    } else if (!ownsKeyboard()) {
      return;
    }
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") {
      itemsR.recoverFocus();
      return;
    }
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onKeyUp = (event) => {
    ctl.handle({ type: "keyup", key: event.key, code: event.code });
  };
  listen(win, "keydown", onKeyDown, true);
  listen(win, "keyup", onKeyUp, true);
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed) return;
    const b = board();
    const current = crumbList[crumbList.length - 1];
    if (current && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current.title !== title) {
        current.title = title;
        chrome.toolbar.setCrumbs(crumbList);
      }
    }
    if (structural || !d) dirty.structural = true;
    if (d && b) {
      for (const uid of d) {
        if (b.edges.has(uid)) dirty.edges.add(uid);
        else dirty.items.add(uid);
      }
    } else dirty.all = true;
    ctl.reconcile();
    dirty.selection = true;
    schedule();
  }));
  subs.push(session.on("links", () => {
    dirty.links = true;
    schedule();
  }));
  subs.push(session.on("busy", (busy) => chrome.toolbar.setSync(Boolean(busy))));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => {
        measure();
        markViewport();
        chrome.ctx.reposition();
      });
      ro.observe(root);
      observers.push(ro);
    } catch {
    }
  }
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => {
    if (isFullscreen) requestFullscreen(false);
  }, win });
  const renderFrame = () => {
    if (disposed) return;
    const b = board();
    if (!b) return;
    const r = rects();
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      itemsR.sync({ board: b, rects: r, dirty: dirty.all ? null : dirty.items, structural: dirty.structural });
      itemsChanged = true;
    }
    if (dirty.all || dirty.structural || dirty.links || dirty.edges.size) {
      const partial = !dirty.all && !dirty.structural && !dirty.links && !dirty.items.size;
      if (partial) {
        edgesR.update({ board: b, edgeUids: dirty.edges, rects: r, zoom: vp.zoom });
      } else {
        edgesR.render({ board: b, rects: r, links: session.links || [], coveredEdges: session.coveredEdges || /* @__PURE__ */ new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
      }
      if (dirty.items.size && !dirty.all && !dirty.structural) {
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: r, zoom: vp.zoom, linkKeys: new Set((session.links || []).map((l) => l.key)), links: session.links || [] });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      const g = gridBackground(vp, setting("grid", "dots"));
      if (g) {
        grid.style.backgroundSize = `${g.size}px ${g.size}px`;
        grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
      }
      chrome.toolbar.setZoom(vp.zoom);
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx();
      else chrome.ctx.hide();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport || itemsChanged) chrome.minimap.update({ board: b, rects: r, vp, size });
    if (itemsChanged && !gesturing) scheduleContent();
    if (searchMatches.length || root.classList.contains("pxd-root--searching")) panel.refreshMarks();
    dirty.viewport = false;
    dirty.items = /* @__PURE__ */ new Set();
    dirty.edges = /* @__PURE__ */ new Set();
    dirty.structural = false;
    dirty.all = false;
    dirty.selection = false;
    dirty.links = false;
  };
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) {
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
  }
  if (!vp) {
    const b = board();
    const r = b ? rects() : /* @__PURE__ */ new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyLod();
  dirty.viewport = true;
  markAll();
  timers.later(() => {
    if (!disposed) scheduleContent();
  }, 0);
  const view = {
    root,
    controller: ctl,
    setFullscreen(on) {
      if (Boolean(on) !== isFullscreen) applyFullscreen(on);
    },
    fit() {
      fitAll();
    },
    stats() {
      return { timers: timers.count(), listeners: listeners2.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctl.cancel();
      releaseCapture();
      if (heightDrag) onHeightUp();
      subs.splice(0).forEach((off) => {
        try {
          off?.();
        } catch {
        }
      });
      routeOff();
      fsDispose();
      applyFullscreenChrome(mountEl, false, doc);
      vpStore.flush?.();
      resumeTimer?.();
      settleTimer?.();
      frameHandle?.();
      itemsR.dispose();
      edgesR.dispose();
      panel.dispose();
      chrome.dispose();
      listeners2.splice(0).forEach((off) => off());
      observers.splice(0).forEach((o) => o.disconnect());
      timers.cancelAll();
      root.remove();
      released = true;
    }
  };
  return view;
}

// src/settings.js
var SETTING_IDS = Object.freeze({
  enabled: "enabled",
  fullscreenOnZoom: "fullscreen-on-zoom",
  graphLinks: "graph-links",
  wheel: "wheel",
  showMinimap: "show-minimap",
  snapGuides: "snap-guides",
  grid: "grid",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  enableShortcuts: "enable-shortcuts",
  showVersionBadge: "show-version-badge",
  disableOnMobile: "disable-on-mobile",
  collapseOutline: "collapse-outline"
});
var DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.fullscreenOnZoom]: true,
  [SETTING_IDS.graphLinks]: "all",
  [SETTING_IDS.wheel]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.snapGuides]: true,
  [SETTING_IDS.grid]: "dots",
  [SETTING_IDS.defaultCardWidth]: 280,
  [SETTING_IDS.defaultCardHeight]: 160,
  [SETTING_IDS.enableShortcuts]: true,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.disableOnMobile]: true,
  [SETTING_IDS.collapseOutline]: true
});
var ENUMS = Object.freeze({
  [SETTING_IDS.graphLinks]: ["off", "attributes", "all"],
  [SETTING_IDS.wheel]: ["pan", "zoom"],
  [SETTING_IDS.grid]: ["dots", "lines", "plain"]
});
var NUMBERS = /* @__PURE__ */ new Set([SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight]);
function settingsDefaults() {
  return { ...DEFAULTS };
}
function normalizeSetting(id, value) {
  const fallback = DEFAULTS[id];
  if (value == null || value === "") return fallback;
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }
  if (NUMBERS.has(id)) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  }
  if (ENUMS[id]) return ENUMS[id].includes(value) ? value : fallback;
  return value;
}
function readSettings(extensionAPI) {
  const out = {};
  for (const id of Object.keys(DEFAULTS)) {
    let raw = null;
    try {
      raw = extensionAPI?.settings?.get?.(id);
    } catch {
      raw = null;
    }
    out[id] = normalizeSetting(id, raw);
  }
  return out;
}
async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) {
      await extensionAPI.settings.set(id, value);
    }
  }
}
var listeners = /* @__PURE__ */ new Set();
function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id, value) {
  for (const fn of [...listeners]) {
    try {
      fn(id, value);
    } catch (error) {
      console.error("[plexus-diagram] Settings listener failed", error);
    }
  }
}
function switchRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "switch", onChange: (event) => emit(id, event?.target?.checked ?? event) }
  };
}
function inputRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "input", onChange: (event) => emit(id, event?.target?.value ?? event) }
  };
}
function selectRow(id, name, description, items) {
  return {
    id,
    name,
    description,
    action: { type: "select", items, onChange: (value) => emit(id, value?.target?.value ?? value) }
  };
}
function createSettingsPanel() {
  return {
    tabTitle: "Plexus Diagram",
    settings: [
      switchRow(SETTING_IDS.enabled, "Enabled", "Master overlay toggle."),
      switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open enhanced diagrams full screen when zoomed into the diagram block. Esc exits."),
      selectRow(SETTING_IDS.graphLinks, "Graph links", "Show links between cards derived from page references and attributes.", ["all", "attributes", "off"]),
      selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch always zooms.", ["pan", "zoom"]),
      switchRow(SETTING_IDS.showMinimap, "Show minimap", "Show the minimap."),
      switchRow(SETTING_IDS.snapGuides, "Snap guides", "Align dragged cards to neighbours and show guides."),
      selectRow(SETTING_IDS.grid, "Grid", "Board background.", ["dots", "lines", "plain"]),
      inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width in pixels for new cards."),
      inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height in pixels for new cards."),
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable board keyboard shortcuts."),
      switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the extension version in the toolbar."),
      switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Skip mounting on mobile clients."),
      switchRow(SETTING_IDS.collapseOutline, "Collapse board blocks in the outline (expand the bullet to see them)", "Collapses an enhanced board block once, so Roam does not list every card, section and connection as bullets under it. Expanding the bullet is remembered.")
    ]
  };
}

// src/feature.js
var PACKAGE_VERSION = package_default.version;
var RECONCILE_INTERVAL_MS = 400;
var NEGATIVE_TTL_MS = 1500;
var LEGACY_METADATA_PAGE = "plexus-diagram/metadata";
var TITLE_PANEL_CLASS = "rm-diagram-title-panel";
var NEW_BOARD_STRING = "{{[[diagram]]:Untitled board}}";
var ANCESTORS_PATTERN = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";
var boardTitle = (s) => parseBoardTitle(s) || UNTITLED_BOARD;
var currentUid = (rec) => rec.crumbs[rec.crumbs.length - 1].uid;
var PARENTS_QUERY = "[:find ?u ?s :in $ ?uid :where [?b :block/uid ?uid] [?b :block/parents ?p] [?p :block/uid ?u] [?p :block/string ?s]]";
function graphFromHash(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/([^/]+)/);
  return match ? match[1] : "unknown";
}
function pulledString(node) {
  return String(node?.[":block/string"] ?? node?.string ?? "");
}
function pulledChildren(node) {
  return node?.[":block/children"] ?? node?.children ?? [];
}
function hasMigratedMark(node) {
  for (const child of pulledChildren(node)) {
    if (/^migrated::\s*2\b/i.test(pulledString(child).trim()) || hasMigratedMark(child)) return true;
  }
  return false;
}
function uidFromLegacyString(value) {
  const token = String(value).trim().split(/\s+/)[0] || "";
  const bare = token.replace(/^(\(\(|\[\[)/, "").replace(/(\)\)|\]\])$/, "");
  return /^[\w-]{6,}$/.test(bare) ? bare : null;
}
function readLegacyEnhanced(host) {
  const out = /* @__PURE__ */ new Set();
  try {
    const pageUid = host.pageUid?.(LEGACY_METADATA_PAGE);
    if (!pageUid) return out;
    const tree = host.api.data.pull("[:block/uid :block/string {:block/children ...}]", [":block/uid", pageUid]);
    const list = pulledChildren(tree).find((child) => /^enhanced::/i.test(pulledString(child).trim()));
    for (const entry of pulledChildren(list)) {
      const uid = uidFromLegacyString(pulledString(entry));
      if (uid && !hasMigratedMark(entry)) out.add(uid);
    }
  } catch (error) {
    console.warn("[plexus-diagram] Could not read the 0.6 enhanced list", error);
  }
  return out;
}
function isMobile(extensionAPI) {
  const flag = extensionAPI?.platform?.isMobile;
  return typeof flag === "function" ? Boolean(flag.call(extensionAPI.platform)) : Boolean(flag);
}
async function installPlexusDiagram({
  extensionAPI,
  lifecycle,
  version,
  mountView,
  host: injectedHost,
  acquireSession: injectedAcquire,
  storage = globalThis.localStorage
}) {
  const doc = globalThis.document;
  const win = globalThis.window ?? globalThis;
  const badge = PACKAGE_VERSION || version || "DEV";
  if (!injectedHost) injectedHost = createHost();
  if (!injectedAcquire) injectedAcquire = acquireSession;
  if (!mountView) mountView = mountBoardView;
  const host = injectedHost;
  const acquireSession2 = injectedAcquire;
  let settings = readSettings(extensionAPI);
  let stopped = false;
  const mounts = /* @__PURE__ */ new Map();
  const trusted = /* @__PURE__ */ new Set();
  const portalObservers = /* @__PURE__ */ new Map();
  const negativeUntil = /* @__PURE__ */ new Map();
  const legacyUids = readLegacyEnhanced(host);
  const guardUids = /* @__PURE__ */ new Set([...readEnhancedUidCache(storage), ...legacyUids]);
  let guardStyle = null;
  const active = () => !stopped && settings[SETTING_IDS.enabled] !== false && !(settings[SETTING_IDS.disableOnMobile] && isMobile(extensionAPI));
  lifecycle.add(() => {
    for (const rec of [...mounts.values()]) unmount(rec);
    for (const observer of portalObservers.values()) observer.disconnect();
    portalObservers.clear();
    for (const el of [...doc?.querySelectorAll?.(`.${OUTLINE_NATIVE_CLASS}`) || []]) el.classList.remove(OUTLINE_NATIVE_CLASS);
    guardStyle?.remove?.();
    guardStyle = null;
  });
  function syncGuard() {
    if (!doc) return;
    if (!active()) {
      if (guardStyle) guardStyle.textContent = "";
      return;
    }
    if (!guardStyle) {
      guardStyle = doc.getElementById?.(PREPAINT_STYLE_ID) || doc.createElement("style");
      guardStyle.id = PREPAINT_STYLE_ID;
      if (!guardStyle.isConnected) doc.head.appendChild(guardStyle);
    }
    guardStyle.textContent = enhancedUidGuardCss(guardUids);
    try {
      writeEnhancedUidCache(guardUids, storage);
    } catch {
    }
  }
  function markEnhanced(uid) {
    trusted.add(uid);
    guardUids.add(uid);
    negativeUntil.delete(uid);
    syncGuard();
  }
  function markNative(uid) {
    trusted.delete(uid);
    legacyUids.delete(uid);
    guardUids.delete(uid);
    syncGuard();
  }
  function isBoardEnhanced(uid) {
    if (trusted.has(uid) || legacyUids.has(uid)) return true;
    const until = negativeUntil.get(uid);
    if (until && until > Date.now()) return false;
    if (readEnhanced(host.api, uid)) {
      trusted.add(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
    negativeUntil.set(uid, Date.now() + NEGATIVE_TTL_MS);
    if (guardUids.has(uid)) {
      guardUids.delete(uid);
      syncGuard();
    }
    return false;
  }
  function titlePanelOf(native) {
    for (const sibling of native.parentElement?.children || []) {
      if (sibling !== native && sibling.classList?.contains(TITLE_PANEL_CLASS)) return sibling;
    }
    return null;
  }
  function setFullscreen(rec, next) {
    rec.fullscreen = Boolean(next);
    try {
      rec.view?.setFullscreen?.(rec.fullscreen);
    } catch (error) {
      console.warn("[plexus-diagram] setFullscreen failed", error);
    }
  }
  function seedCrumbs(uid) {
    const self = { uid, title: boardTitle(host.blockString?.(uid)) };
    try {
      const res = host.api.data.pull(ANCESTORS_PATTERN, [":block/uid", uid]);
      const parents = res?.[":block/parents"] ?? [];
      const chain = parents.filter((p) => isDiagramString(pulledString(p)) && readPlexus(p[":block/props"] ?? p.props)?.v === 2).map((p) => ({ uid: p[":block/uid"], title: boardTitle(p[":block/string"]), depth: (p[":block/parents"] ?? []).length })).sort((a, b) => a.depth - b.depth).map(({ uid: u, title }) => ({ uid: u, title }));
      return [...chain, self];
    } catch {
      return [self];
    }
  }
  const isDiagramUid = (candidate) => isDiagramString(host.blockString?.(candidate));
  function unmountOutlineCopies(parent) {
    for (const other of [...mounts.values()]) {
      if (other !== parent && insideEnhancedOutline(other.native)) unmount(other);
    }
  }
  function collapseOnce(uid, native) {
    if (settings[SETTING_IDS.collapseOutline] === false || !storage?.getItem || !storage?.setItem) return;
    if (native?.closest?.(".bp3-portal")) return;
    const key = `plexus-diagram:collapsed:${graphFromHash()}:${uid}`;
    let state;
    try {
      if (storage.getItem(key)) return;
      state = host.api.data.pull("[:block/open]", [":block/uid", uid]);
      if (!state) return;
      storage.setItem(key, "1");
    } catch {
      return;
    }
    if (state[":block/open"] === false) return;
    Promise.resolve().then(() => host.setOpen(uid, false)).catch((error) => console.warn("[plexus-diagram] Could not collapse the board block", uid, error));
  }
  function mountRecView(rec, { autofocus = false } = {}) {
    return mountView({
      host,
      session: rec.session,
      mountEl: rec.mountEl,
      nativeEl: rec.native,
      settings,
      fullscreen: rec.fullscreen,
      version: badge,
      onRequestFullscreen: (want) => setFullscreen(rec, want === void 0 ? !rec.fullscreen : want),
      crumbs: rec.crumbs.slice(),
      routeUid: rec.uid,
      autofocus,
      onOpenBoard: (child) => navigate(rec, [...rec.crumbs, { uid: child, title: boardTitle(host.blockString?.(child)) }]),
      onCrumb: (index) => navigate(rec, rec.crumbs.slice(0, index + 1))
    });
  }
  function watchRec(rec) {
    const session = rec.session;
    const offGone = session.on?.("gone", () => {
      if (currentUid(rec) !== rec.uid) navigate(rec, rec.crumbs.slice(0, -1));
      else unmount(rec);
    });
    const offChange = session.on?.("change", () => {
      if (!session.board || session.board.enhanced !== false) return;
      if (currentUid(rec) !== rec.uid) {
        navigate(rec, rec.crumbs.slice(0, -1));
      } else if (!legacyUids.has(rec.uid)) {
        markNative(rec.uid);
        unmount(rec);
      }
    });
    return () => {
      offGone?.();
      offChange?.();
    };
  }
  function navigate(rec, next) {
    queueMicrotask(() => {
      if (stopped || mounts.get(rec.native) !== rec || !next.length) return;
      const target = next[next.length - 1].uid;
      if (target === currentUid(rec)) return;
      if (!readEnhanced(host.api, target)) {
        try {
          Promise.resolve(host.openBlock?.(target)).catch(() => {
          });
        } catch {
        }
        return;
      }
      let session;
      try {
        session = acquireSession2(target, { host, settings });
      } catch (error) {
        console.warn("[plexus-diagram] Could not open the nested board", error);
        return;
      }
      if (!session?.board) {
        session?.release?.();
        return;
      }
      try {
        rec.off?.();
      } catch {
      }
      rec.off = null;
      try {
        rec.view?.dispose?.();
      } catch (error) {
        console.warn("[plexus-diagram] view dispose failed", error);
      }
      try {
        rec.session?.release?.();
      } catch (error) {
        console.warn("[plexus-diagram] session release failed", error);
      }
      rec.session = session;
      rec.crumbs = next;
      try {
        rec.view = mountRecView(rec, { autofocus: true });
        rec.off = watchRec(rec);
      } catch (error) {
        console.error("[plexus-diagram] Nested mount failed; native diagram restored", error);
        negativeUntil.set(rec.uid, Date.now() + 10 * NEGATIVE_TTL_MS);
        unmount(rec);
      }
    });
  }
  function mount(uid, native, { crumbs } = {}) {
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    mountEl.dataset.diagramUid = uid;
    const titlePanel = titlePanelOf(native);
    native.classList.remove(OUTLINE_NATIVE_CLASS);
    titlePanel?.classList.remove(OUTLINE_NATIVE_CLASS);
    const rec = {
      uid,
      native,
      mountEl,
      titlePanel,
      titleDisplay: titlePanel ? titlePanel.style.display : "",
      session: null,
      view: null,
      crumbs: crumbs ?? seedCrumbs(uid),
      fullscreen: false,
      off: null
    };
    native.classList.add(NATIVE_HIDDEN_CLASS);
    if (titlePanel) titlePanel.style.display = "none";
    native.after(mountEl);
    mounts.set(native, rec);
    try {
      rec.session = acquireSession2(currentUid(rec), { host, settings });
      rec.fullscreen = settings[SETTING_IDS.fullscreenOnZoom] !== false && !routeLeftZoomedDiagram(uid);
      rec.view = mountRecView(rec);
      rec.off = watchRec(rec);
    } catch (error) {
      console.error("[plexus-diagram] Mount failed; native diagram restored", error);
      negativeUntil.set(uid, Date.now() + 10 * NEGATIVE_TTL_MS);
      unmount(rec);
      return null;
    }
    unmountOutlineCopies(rec);
    collapseOnce(uid, native);
    if (currentUid(rec) === uid) migrateLegacy(rec);
    return rec;
  }
  function migrateLegacy(rec) {
    const { uid, session } = rec;
    if (!legacyUids.has(uid) || readEnhanced(host.api, uid)) return;
    const key = `plexus-diagram:migrated:${graphFromHash()}:${uid}`;
    try {
      if (storage?.getItem?.(key)) return;
      storage?.setItem?.(key, "1");
    } catch {
    }
    if (rec.migrating) return;
    rec.migrating = true;
    Promise.resolve().then(() => session.enhance()).then(() => markEnhanced(uid)).catch((error) => console.warn("[plexus-diagram] 0.6 import failed", uid, error));
  }
  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
    mounts.delete(rec.native);
    try {
      rec.off?.();
    } catch {
    }
    try {
      rec.view?.dispose?.();
    } catch (error) {
      console.warn("[plexus-diagram] view dispose failed", error);
    }
    try {
      rec.session?.release?.();
    } catch (error) {
      console.warn("[plexus-diagram] session release failed", error);
    }
    rec.mountEl.remove();
    rec.native.classList.remove(NATIVE_HIDDEN_CLASS);
    if (rec.titlePanel) rec.titlePanel.style.display = rec.titleDisplay;
  }
  const uidByNative = /* @__PURE__ */ new WeakMap();
  const outlineOwnerByNative = /* @__PURE__ */ new WeakMap();
  function insideEnhancedOutline(native) {
    const cached = outlineOwnerByNative.get(native);
    if (cached) {
      if (isBoardEnhanced(cached)) return true;
      outlineOwnerByNative.delete(native);
    }
    const own = native.closest?.(BLOCK_CONTAINER_SELECTOR);
    let container = own ? own.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR) : null;
    while (container) {
      const uid = blockContainerUid(container, isDiagramUid);
      if (uid && isBoardEnhanced(uid)) {
        outlineOwnerByNative.set(native, uid);
        return true;
      }
      container = container.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR);
    }
    return false;
  }
  function consider(native, options) {
    if (stopped || !native || mounts.has(native) || native.isConnected === false) return;
    if (!active()) return;
    if (native.parentElement?.closest?.(".pxd-native-hidden, .pxd-root")) return;
    let uid = uidByNative.get(native);
    if (uid === void 0) {
      uid = findDiagramUidFromEl(native, isDiagramUid) || null;
      uidByNative.set(native, uid);
    }
    if (!uid || !isBoardEnhanced(uid)) return;
    if (insideEnhancedOutline(native)) {
      native.classList.add(OUTLINE_NATIVE_CLASS);
      titlePanelOf(native)?.classList.add(OUTLINE_NATIVE_CLASS);
      return;
    }
    mount(uid, native, options);
  }
  function scanAdded(node) {
    for (const diagram of diagramsWithin(node)) consider(diagram);
  }
  function reconcile() {
    if (stopped) return;
    for (const rec of [...mounts.values()]) {
      if (rec.native.isConnected === false || rec.mountEl.isConnected === false) unmount(rec);
    }
    for (const [node, observer] of portalObservers) {
      if (node.isConnected === false) {
        observer.disconnect();
        portalObservers.delete(node);
      }
    }
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    if (!doc) return;
    for (const diagram of doc.querySelectorAll(".rm-diagram")) consider(diagram);
  }
  function onNavigate() {
    for (const rec of mounts.values()) {
      if (routeLeftZoomedDiagram(rec.uid)) {
        if (rec.fullscreen) setFullscreen(rec, false);
      } else if (settings[SETTING_IDS.fullscreenOnZoom] !== false && !rec.fullscreen) {
        setFullscreen(rec, true);
      }
    }
    reconcile();
  }
  function focusedUid(context) {
    return context?.["block-uid"] || host.api?.ui?.getFocusedBlock?.()?.["block-uid"] || extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"] || null;
  }
  function diagramAncestorUid(uid) {
    if (!uid) return null;
    if (isDiagramString(host.blockString?.(uid))) return uid;
    try {
      const rows = host.q?.(PARENTS_QUERY, uid) || [];
      const hits = rows.filter((row) => isDiagramString(row[1])).map((row) => row[0]);
      if (hits.length < 2) return hits[0] ?? null;
      const deepest = hits.find((cand) => {
        const above = new Set((host.q?.(PARENTS_QUERY, cand) || []).map((row) => row[0]));
        return hits.every((other) => other === cand || above.has(other));
      });
      return deepest ?? hits[0];
    } catch {
      return null;
    }
  }
  function resolveBoardUid(context) {
    const fromFocus = diagramAncestorUid(focusedUid(context));
    if (fromFocus) return fromFocus;
    const zoomed = diagramUidFromLocation();
    if (zoomed && isDiagramString(host.blockString?.(zoomed))) return zoomed;
    const uids = new Set([...mounts.values()].map((rec) => rec.uid));
    return uids.size === 1 ? [...uids][0] : null;
  }
  async function enhanceCommand(context) {
    const uid = resolveBoardUid(context);
    if (!uid) {
      console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
      return;
    }
    const session = acquireSession2(uid, { host, settings });
    try {
      await session.enhance();
    } finally {
      session.release();
    }
    markEnhanced(uid);
    reconcile();
  }
  async function restoreCommand(context) {
    const uid = resolveBoardUid(context);
    if (!uid) return;
    const session = acquireSession2(uid, { host, settings });
    try {
      await session.restoreNative();
    } finally {
      session.release();
    }
    markNative(uid);
    for (const rec of [...mounts.values()]) if (rec.uid === uid) unmount(rec);
  }
  async function newWhiteboardCommand(context) {
    const parentUid = focusedUid(context);
    if (!parentUid) {
      console.info("[plexus-diagram] Focus a block first; the whiteboard is created under it");
      return;
    }
    const uid = host.generateUid();
    await host.createBlock({
      parentUid,
      order: "last",
      uid,
      string: NEW_BOARD_STRING,
      props: { plexus: { v: 2 } },
      open: settings[SETTING_IDS.collapseOutline] === false ? void 0 : false
    });
    markEnhanced(uid);
    await host.openBlock(uid);
  }
  function fullscreenCommand(context) {
    const uid = resolveBoardUid(context);
    const recs = [...mounts.values()].filter((rec2) => !uid || rec2.uid === uid);
    const rec = recs.find((r) => r.native.isConnected !== false) || recs[0];
    if (rec) setFullscreen(rec, !rec.fullscreen);
  }
  async function registerCommands() {
    const commands = [
      ["Plexus: Enhance this diagram", enhanceCommand],
      ["Plexus: New whiteboard here", newWhiteboardCommand],
      ["Plexus: Restore native diagram", restoreCommand],
      ["Plexus: Fullscreen this diagram", fullscreenCommand]
    ];
    for (const [label, fn] of commands) {
      const callback = (context) => {
        if (!active()) {
          console.info("[plexus-diagram] Command skipped: extension disabled");
          return;
        }
        Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
      };
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback });
      if (extensionAPI.ui?.slashCommand?.addCommand) {
        await lifecycle.command(extensionAPI.ui.slashCommand, { label, callback });
      }
    }
    if (extensionAPI.ui?.blockContextMenu?.addCommand) {
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Plexus: Enhance",
        "display-conditional": (event) => isDiagramString(event?.["block-string"]),
        callback: (event) => {
          if (!active()) return;
          enhanceCommand(event).catch((error) => console.warn("[plexus-diagram] Enhance failed", error));
        }
      });
    }
  }
  lifecycle.add(onSettingsChange((id, value) => {
    if (stopped) return;
    settings = { ...settings, [id]: normalizeSetting(id, value) };
    syncGuard();
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    for (const rec of [...mounts.values()]) {
      try {
        if (typeof rec.view?.setSettings === "function") {
          rec.view.setSettings(settings);
        } else {
          const { native, crumbs } = rec;
          unmount(rec);
          consider(native, { crumbs });
        }
      } catch (error) {
        console.warn("[plexus-diagram] Settings propagation failed", error);
      }
    }
    reconcile();
  }));
  const api = {
    version: badge,
    stats: host.stats,
    mounts: () => [...mounts.values()].map((rec) => ({
      uid: rec.uid,
      current: currentUid(rec),
      crumbs: rec.crumbs.map((c) => c.uid),
      fullscreen: rec.fullscreen,
      connected: rec.native.isConnected !== false && rec.mountEl.isConnected !== false
    }))
  };
  win.__plexusDiagram = api;
  lifecycle.add(() => {
    if (win.__plexusDiagram === api) delete win.__plexusDiagram;
  });
  syncGuard();
  await registerCommands();
  if (doc && typeof globalThis.MutationObserver === "function") {
    const onAdded = (records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1) scanAdded(node);
        }
      }
    };
    const app = doc.querySelector(".roam-app");
    if (app) lifecycle.observer(new MutationObserver(onAdded), app, { childList: true, subtree: true });
    if (doc.body) {
      lifecycle.observer(new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (node.nodeType !== 1 || !node.classList?.contains("bp3-portal") || portalObservers.has(node)) continue;
            const observer = new MutationObserver(onAdded);
            observer.observe(node, { childList: true, subtree: true });
            portalObservers.set(node, observer);
            scanAdded(node);
          }
        }
      }), doc.body, { childList: true });
    }
  }
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onNavigate);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  lifecycle.add(() => {
    stopped = true;
  });
  reconcile();
}

// src/extension.js
var activeLifecycle = null;
async function onload({ extensionAPI, extension, deps }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    await installPlexusDiagram({ extensionAPI, lifecycle, version: extension?.version, ...deps });
    console.info(`[plexus-diagram] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}
async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus-diagram] Unloaded");
}
var extension_default = { onload, onunload };
export {
  extension_default as default,
  enhancedUidGuardCss,
  isDiagramString,
  onload,
  onunload,
  settingsDefaults
};
