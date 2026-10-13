// In-memory fake of window.roamAlphaAPI for session and view tests.
// API: createFakeRoam(opts) -> fake. See the header of each section.

const colonKeys = (v) => {
  if (Array.isArray(v)) return v.map(colonKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k.startsWith(":") ? k : `:${k}`] = colonKeys(val);
    return out;
  }
  return v;
};

const plainKeys = (v) => {
  if (Array.isArray(v)) return v.map(plainKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k.startsWith(":") ? k.slice(1) : k] = plainKeys(val);
    return out;
  }
  return v;
};

function parseEntity(entity) {
  if (Array.isArray(entity)) return { key: entity[0], value: entity[1] };
  const m = /^\[\s*(:[\w/.-]+)\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(String(entity));
  if (m) return { key: m[1], value: m[2] };
  return { key: ":block/uid", value: String(entity) };
}

// A pull pattern's :block/children shape: {kids: spec | "rec" | null}. Enough of EDN for the patterns Plexus uses.
function parseEdn(text) {
  const src = String(text);
  let i = 0;
  const ws = () => { while (i < src.length && /[\s,]/.test(src[i])) i += 1; };
  const read = () => {
    ws();
    const c = src[i];
    if (c === "[" || c === "(" || c === "{") {
      const close = c === "[" ? "]" : c === "(" ? ")" : "}";
      i += 1;
      const items = [];
      for (;;) {
        ws();
        if (src[i] === close) { i += 1; break; }
        if (i >= src.length) break;
        items.push(read());
      }
      return { t: c, items };
    }
    if (c === "\"") {
      let j = i + 1;
      while (j < src.length && src[j] !== "\"") j += src[j] === "\\" ? 2 : 1;
      const v = src.slice(i + 1, j);
      i = j + 1;
      return v;
    }
    let j = i;
    while (j < src.length && !/[\s,\[\]{}()]/.test(src[j])) j += 1;
    const tok = src.slice(i, j);
    i = j;
    return tok;
  };
  return read();
}
function childSpec(vec) {
  if (!vec || vec.t !== "[") return null;
  for (const item of vec.items) {
    if (item?.t !== "{") continue;
    for (let k = 0; k + 1 < item.items.length; k += 2) {
      const key = item.items[k];
      const name = typeof key === "string" ? key : key?.t === "(" ? key.items[1] : null;
      if (name !== ":block/children") continue;
      const val = item.items[k + 1];
      return { kids: val === "..." ? "rec" : childSpec(val) };
    }
  }
  return { kids: null };
}
const specCache = new Map();
const specOf = (pattern) => {
  const key = String(pattern);
  if (!specCache.has(key)) {
    let spec = null;
    try { spec = childSpec(parseEdn(key)); } catch { spec = null; }
    specCache.set(key, spec);
  }
  return specCache.get(key);
};
const cutTree = (node, spec, counter) => {
  if (!node || typeof node !== "object") return node;
  if (counter) counter.n += 1;
  const kids = node[":block/children"];
  if (!spec || !Array.isArray(kids)) return node;
  const next = spec.kids === "rec" ? spec : spec.kids;
  if (!next) { delete node[":block/children"]; return node; }
  node[":block/children"] = kids.map((k) => cutTree(k, next, counter));
  return node;
};

export function createFakeRoam({ echoDelay = 5, writeDelay = 0, echoMode = "fresh", hash = "#/app/testgraph" } = {}) {
  const blocks = new Map(); // uid -> {uid,string,order,heading,open,props,children[],parent,eid,diagram?}
  const pages = new Map(); // uid -> {uid,title,children[],eid}
  const watches = []; // {pattern, entity, cb, uid}
  const timers = new Set();
  let eidCounter = 100;
  let uidCounter = 0;
  let qHandler = () => [];
  const qRoutes = [];
  let uploadStub = null;

  const fake = {
    echoDelay,
    writeDelay,
    echoMode, // "fresh": echo carries the state at fire time; "snapshot": state right after that write
    log: [],
    calls: [],
    failNext: 0,
    hash,
    roamWatch: false,
    watchRuns: 0,
    pullCounter: null,
  };

  const parentOf = (uid) => {
    const b = blocks.get(uid);
    if (!b) return null;
    return b.parent;
  };
  const containerOf = (parentUid) => blocks.get(parentUid) ?? pages.get(parentUid) ?? null;
  const renumber = (parent) => {
    parent.children.forEach((u, i) => { const c = blocks.get(u); if (c) c.order = i; });
  };
  const detach = (uid) => {
    const b = blocks.get(uid);
    const p = b && b.parent ? containerOf(b.parent) : null;
    if (p) { p.children = p.children.filter((u) => u !== uid); renumber(p); }
  };
  const attach = (uid, parentUid, order) => {
    const b = blocks.get(uid);
    const p = containerOf(parentUid);
    if (!p) throw new Error(`fake-roam: unknown parent ${parentUid}`);
    const list = p.children;
    const idx = order === "last" || order == null ? list.length : Math.max(0, Math.min(list.length, order));
    list.splice(idx, 0, uid);
    b.parent = parentUid;
    renumber(p);
  };

  function makeBlock({ uid, string = "", props, heading, open = true }) {
    const b = {
      uid: uid ?? fake.generateUid(),
      string,
      order: 0,
      heading: heading || 0,
      open,
      props: props ? plainKeys(props) : {},
      children: [],
      parent: null,
      eid: ++eidCounter,
    };
    blocks.set(b.uid, b);
    return b;
  }

  // One fromMarkdown is one undo, even when it builds a nested tree. Generic create/update stay
  // call-counters only: existing undo tests assert call names and must not see blocks disappear.
  const undoStack = [];
  // fake.trackUndo = true: every block/page write is one undo entry that restores the whole tree (opt-in).
  const history = [];
  const redoStack = [];
  const takeState = () => ({ blocks: structuredClone([...blocks]), pages: structuredClone([...pages]) });
  const putState = (state) => {
    blocks.clear(); pages.clear();
    for (const [k, v] of state.blocks) blocks.set(k, v);
    for (const [k, v] of state.pages) pages.set(k, v);
    for (const w of watches.slice()) {
      schedule(() => { if (watches.includes(w)) w.cb(null, pull(w.pattern, [":block/uid", w.uid])); }, fake.echoDelay);
    }
  };
  const CONSUMED = new Set(["\\", "#", "`", "*", "-", ".", ">", "[", "]", "(", ")"]);
  const unescapeMeasured = (line) => {
    let out = "";
    const src = String(line ?? "");
    for (let i = 0; i < src.length; i += 1) {
      const next = src[i + 1];
      if (src[i] === "\\" && next != null && CONSUMED.has(next)) {
        out += next;
        i += 1;
      } else out += src[i];
    }
    return out;
  };
  function dropTree(uid) {
    const b = blocks.get(uid);
    if (!b) return;
    for (const child of b.children.slice()) dropTree(child);
    detach(uid);
    blocks.delete(uid);
  }
  function parseMarkdownRoots(markdown) {
    const root = { children: [] };
    const stack = [{ depth: -1, node: root }];
    let current = null;
    for (const line of String(markdown ?? "").split("\n")) {
      if (!line.trim()) continue;
      const bullet = /^(\s*)- (.*)$/.exec(line);
      if (!bullet) {
        if (current) current.string += `\n${unescapeMeasured(line.trim())}`;
        continue;
      }
      const depth = Math.floor(bullet[1].length / 2);
      const node = makeBlock({ string: unescapeMeasured(bullet[2]) });
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1].node;
      if (parent === root) root.children.push(node);
      else {
        node.parent = parent.uid;
        parent.children.push(node.uid);
        node.order = parent.children.length - 1;
      }
      stack.push({ depth, node });
      current = node;
    }
    return root.children;
  }

  function pullBlock(uid) {
    const b = blocks.get(uid);
    if (!b) return null;
    const out = { ":db/id": b.eid, ":block/uid": b.uid, ":block/string": b.string, ":block/order": b.order, ":block/open": b.open };
    if (b.heading) out[":block/heading"] = b.heading;
    if (b.props && Object.keys(b.props).length) out[":block/props"] = colonKeys(b.props);
    if (b.children.length) out[":block/children"] = b.children.map(pullBlock);
    if (b.diagram) {
      out[":diagram/nodes"] = b.diagram.nodes.map((n) => {
        const node = { ":db/id": n.id, ":diagram.node/data": n.data };
        if (n.blockUid) node[":diagram.node/block"] = { ":block/uid": n.blockUid, ":block/string": blocks.get(n.blockUid)?.string ?? "" };
        if (n.parentId != null) node[":diagram.node/parent-node"] = { ":db/id": n.parentId };
        return node;
      });
      out[":diagram/edges"] = b.diagram.edges.map((e) => ({
        ":diagram.edge/source": { ":db/id": e.source },
        ":diagram.edge/target": { ":db/id": e.target },
        ":diagram.edge/data": e.data,
      }));
    }
    return out;
  }

  function pullPage(uid) {
    const p = pages.get(uid);
    if (!p) return null;
    const out = { ":db/id": p.eid, ":block/uid": p.uid, ":node/title": p.title };
    if (p.children.length) out[":block/children"] = p.children.map(pullBlock);
    return out;
  }

  // Roam's DataScript pull returns at most 1000 values of a ref-many attribute unless the pattern says
  // `(limit :block/children nil)`.
  const CHILDREN_CAP = 1000;
  function capChildren(node) {
    const kids = node?.[":block/children"];
    if (!kids) return;
    if (kids.length > CHILDREN_CAP) node[":block/children"] = kids.slice(0, CHILDREN_CAP);
    for (const k of node[":block/children"]) capChildren(k);
  }

  function pull(pattern, entity) {
    const out = pullUncapped(pattern, entity);
    if (out && !String(pattern).includes("(limit :block/children nil)")) capChildren(out);
    // fake.roamWatch: the pull keeps only the children levels the pattern names; fake.pulledNodes counts blocks.
    if (out && fake.roamWatch) {
      const spec = specOf(pattern);
      if (spec) cutTree(out, spec, fake.pullCounter);
    }
    return out;
  }

  function pullUncapped(pattern, entity) {
    const { key, value } = parseEntity(entity);
    let out = null;
    if (key === ":node/title") {
      const p = [...pages.values()].find((x) => x.title === value);
      out = p ? pullPage(p.uid) : null;
    } else if (key === ":db/id") {
      const b = [...blocks.values()].find((x) => x.eid === value);
      out = b ? pullBlock(b.uid) : null;
    } else if (pages.has(value)) out = pullPage(value);
    else out = pullBlock(value);
    if (out && String(pattern).includes(":block/_children")) {
      const child = blocks.get(out[":block/uid"]);
      const par = child?.parent ? containerOf(child.parent) : null;
      if (par) {
        out[":block/_children"] = [{
          ":db/id": par.eid,
          ":block/uid": par.uid,
          ":block/string": par.string ?? par.title ?? "",
        }];
      }
    }
    return out;
  }

  // ---- watches ----
  function topUid(uid) {
    const chain = [];
    let cur = uid;
    while (cur) { chain.push(cur); cur = blocks.get(cur)?.parent ?? null; }
    return chain;
  }

  function schedule(fn, delay) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, delay);
    timers.add(t);
  }

  // Roam: 100 ms after the last transaction every watch pulls again; a changed result calls back with old and new.
  let roamTimer = null;
  function roamNotify() {
    if (roamTimer) { clearTimeout(roamTimer); timers.delete(roamTimer); }
    roamTimer = setTimeout(() => {
      timers.delete(roamTimer);
      roamTimer = null;
      fake.watchRuns += 1;
      for (const w of watches.slice()) {
        if (!watches.includes(w)) continue;
        const after = pull(w.pattern, w.entity);
        const key = JSON.stringify(after);
        if (key === w.past) continue;
        const before = w.past == null ? null : JSON.parse(w.past);
        w.past = key;
        w.cb(before, after);
      }
    }, fake.echoDelay);
    timers.add(roamTimer);
  }

  function notify(uid, before, chainBefore = []) {
    if (fake.roamWatch) { roamNotify(); return; }
    const chain = new Set([...topUid(uid), ...chainBefore]);
    for (const w of watches.slice()) {
      if (!chain.has(w.uid)) continue;
      const after = fake.echoMode === "snapshot" ? structuredClone(pull(w.pattern, [":block/uid", w.uid])) : null;
      schedule(() => {
        if (!watches.includes(w)) return;
        w.cb(before.get(w.uid) ?? null, fake.echoMode === "snapshot" ? after : pull(w.pattern, [":block/uid", w.uid]));
      }, fake.echoDelay);
    }
  }

  function snapshotBefore(uid) {
    const before = new Map();
    if (fake.roamWatch) return before;
    for (const w of watches) before.set(w.uid, structuredClone(pull(w.pattern, [":block/uid", w.uid])));
    return before;
  }

  function write(uid, fn, logEntry) {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (fake.failNext > 0) {
          fake.failNext--;
          fake.log.push(["fail", ...logEntry]);
          reject(new Error("fake-roam: write failed"));
          return;
        }
        const before = snapshotBefore(uid);
        const chainBefore = topUid(uid);
        if (fake.trackUndo) {
          const entries = logEntry[0] === "page-create" ? fake.pageCreateEntries || 1 : 1; // real Roam may stack more than one
          for (let i = 0; i < entries; i += 1) history.push(takeState());
          redoStack.length = 0;
        }
        fn();
        fake.log.push(logEntry);
        notify(uid, before, chainBefore);
        resolve();
      };
      if (fake.writeDelay > 0) schedule(run, fake.writeDelay);
      else run();
    });
  }

  const runQ = (query, ...inputs) => {
    for (const r of qRoutes) if (r.match.test(String(query))) { r.calls.push([query, ...inputs]); return r.fn(query, ...inputs); }
    return qHandler(query, ...inputs);
  };

  const api = {
    util: { generateUID: () => fake.generateUid() },
    data: {
      pull,
      q: (...args) => runQ(...args),
      fast: { q: (...args) => runQ(...args) },
      addPullWatch(pattern, entity, cb) {
        const { value } = parseEntity(entity);
        const past = fake.roamWatch ? JSON.stringify(pull(pattern, entity)) : null;
        watches.push({ pattern, entity, cb, uid: value, past });
        return true;
      },
      removePullWatch(pattern, entity, cb) {
        const i = watches.findIndex((w) => w.cb === cb && w.entity === entity);
        if (i >= 0) watches.splice(i, 1);
        return true;
      },
      block: {
        create({ location, block }) {
          return write(block.uid ?? location["parent-uid"], () => {
            const b = makeBlock({ uid: block.uid, string: block.string ?? "", props: block.props, heading: block.heading, open: block.open ?? true });
            block.uid = b.uid;
            attach(b.uid, location["parent-uid"], location.order);
          }, ["create", block.uid ?? "?"]);
        },
        update({ block }) {
          const { uid, ...fields } = block;
          return write(uid, () => {
            const b = blocks.get(uid);
            if (!b) throw new Error(`fake-roam: update unknown ${uid}`);
            if (fields.string !== undefined) b.string = fields.string;
            if (fields.props !== undefined) b.props = plainKeys(fields.props);
            if (fields.open !== undefined) b.open = fields.open;
            if (fields.heading !== undefined) b.heading = fields.heading;
          }, ["update", uid, structuredClone(fields)]);
        },
        move({ location, block }) {
          return write(block.uid, () => {
            detach(block.uid);
            attach(block.uid, location["parent-uid"], location.order);
          }, ["move", block.uid, location["parent-uid"], location.order ?? "last"]);
        },
        delete({ block }) {
          return write(block.uid, () => {
            const drop = (u) => {
              const b = blocks.get(u);
              if (!b) return;
              b.children.slice().forEach(drop);
              blocks.delete(u);
            };
            detach(block.uid);
            drop(block.uid);
          }, ["delete", block.uid]);
        },
        fromMarkdown({ location, "markdown-string": markdown }) {
          const parentUid = location?.["parent-uid"];
          const entry = ["fromMarkdown", parentUid, 0];
          let uids = [];
          return write(parentUid, () => {
            const roots = parseMarkdownRoots(markdown);
            uids = roots.map((node) => node.uid);
            entry[2] = roots.length;
            const start = location?.order;
            roots.forEach((node, i) => {
              const order = typeof start === "number" ? start + i : "last";
              attach(node.uid, parentUid, order);
            });
            if (!fake.trackUndo) undoStack.push(() => { for (const node of roots) dropTree(node.uid); });
            try { fake.onFromMarkdown?.(uids); } catch { /* a test hook must not abort the write */ }
          }, entry).then(() => ({ uids }));
        },
      },
      page: {
        create({ page }) {
          return write(page.uid ?? page.title, () => {
            const uid = page.uid ?? fake.generateUid();
            pages.set(uid, { uid, title: page.title, children: [], eid: ++eidCounter });
          }, ["page-create", page.uid ?? "?", page.title]);
        },
        delete({ page }) {
          return write(page.uid, () => {
            const p = pages.get(page.uid);
            if (!p) return;
            for (const u of p.children.slice()) dropTree(u);
            pages.delete(page.uid);
          }, ["page-delete", page.uid]);
        },
        update(arg) {
          const page = arg?.page || {};
          const nextTitle = arg?.new?.title ?? (page.uid ? page.title : undefined);
          return write(page.uid || page.title, () => {
            let found = null;
            for (const p of pages.values()) {
              if (page.uid && p.uid === page.uid) found = p;
              else if (!page.uid && page.title && p.title === page.title) found = p;
            }
            if (!found) throw new Error(`fake-roam: page update unknown ${page.uid || page.title}`);
            if (nextTitle !== undefined) found.title = nextTitle;
          }, ["page-update", page.uid || page.title, nextTitle]);
        },
      },
      undo() {
        fake.calls.push(["undo"]);
        if (fake.trackUndo) {
          const prev = history.pop();
          if (prev) { redoStack.push(takeState()); putState(prev); }
          return Promise.resolve();
        }
        const fn = undoStack.pop();
        if (typeof fn === "function") fn();
        return Promise.resolve();
      },
      redo() {
        fake.calls.push(["redo"]);
        if (fake.trackUndo) {
          const next = redoStack.pop();
          if (next) { history.push(takeState()); putState(next); }
        }
        return Promise.resolve();
      },
    },
    get file() {
      if (!uploadStub && !fileGetStub) return undefined;
      const file = {};
      if (uploadStub) file.upload = uploadStub;
      if (fileGetStub) file.get = fileGetStub;
      return file;
    },
    ui: {
      rightSidebar: { addWindow: (arg) => { fake.calls.push(["addWindow", arg]); return Promise.resolve(); } },
      mainWindow: { openBlock: (arg) => { fake.calls.push(["openBlock", arg]); return Promise.resolve(); } },
      components: {
        renderString(arg) { fake.calls.push(["renderString", arg]); mark(arg.el, `[string:${arg.string}]`); },
        renderBlock(arg) { fake.calls.push(["renderBlock", arg]); mark(arg.el, `[block:${arg.uid}]`); },
        renderPage(arg) { fake.calls.push(["renderPage", arg]); mark(arg.el, `[page:${arg.uid}]`); },
        unmountNode(arg) { fake.calls.push(["unmountNode", arg]); mark(arg.el, ""); },
      },
    },
  };
  function mark(el, text) {
    if (el && typeof el === "object" && "textContent" in el) el.textContent = text;
  }

  // ---- storage ----
  const store = new Map();
  fake.storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _map: store,
  };

  fake.api = api;
  fake.onFromMarkdown = null;
  fake.pushUndo = (fn) => { if (typeof fn === "function") undoStack.push(fn); };
  fake.dropTree = (uid) => dropTree(uid);
  fake.stampProps = (uid, props) => {
    const b = blocks.get(uid);
    if (!b || !props || typeof props !== "object") return;
    Object.assign(b.props, plainKeys(props));
  };
  fake.generateUid = () => `gen${String(++uidCounter).padStart(6, "0")}`;
  fake.setQ = (fn) => { qHandler = fn; };
  // Route q calls whose query text matches `match` (RegExp) to fn; returns {calls} for asserting.
  fake.onQuery = (match, fn) => { const r = { match, fn, calls: [] }; qRoutes.push(r); return r; };
  let fileGetStub = null;
  fake.setUpload = (fn) => { uploadStub = fn; };
  fake.setFileGet = (fn) => { fileGetStub = fn; };
  fake.watchCount = () => watches.length;
  fake.pull = (uid) => pull("[*]", [":block/uid", uid]);
  fake.block = (uid) => {
    const b = blocks.get(uid);
    return b ? { uid: b.uid, string: b.string, order: b.order, heading: b.heading, open: b.open, props: structuredClone(b.props), parent: b.parent, children: b.children.slice() } : null;
  };
  fake.props = (uid) => structuredClone(blocks.get(uid)?.props ?? null);
  fake.children = (uid) => (containerOf(uid)?.children ?? []).slice();
  fake.has = (uid) => blocks.has(uid) || pages.has(uid);
  fake.writesLog = () => fake.log.filter((e) => e[0] !== "fail");
  fake.clearLog = () => { fake.log.length = 0; fake.calls.length = 0; };
  fake.flush = () => new Promise((resolve) => {
    const tick = () => (timers.size ? setTimeout(tick, Math.max(2, fake.echoDelay)) : resolve());
    setTimeout(tick, 0);
  });

  fake.seedPage = ({ title, uid = fake.generateUid(), children = [] }) => {
    pages.set(uid, { uid, title, children: [], eid: ++eidCounter });
    seedChildren(uid, children);
    return uid;
  };

  function seedChildren(parentUid, list) {
    for (const c of list) {
      const b = makeBlock({ uid: c.uid, string: c.string, props: c.props, heading: c.heading, open: c.open ?? true });
      attach(b.uid, parentUid, "last");
      if (c.children?.length) seedChildren(b.uid, c.children);
    }
  }

  // diagram: {nodes:[{id, blockUid, data, parentId?}], edges:[{source, target, data}]} (native :diagram/* entities)
  fake.seedBoard = ({ uid, string = "{{[[diagram]]}}", props, children = [], parent, diagram }) => {
    const b = makeBlock({ uid, string, props });
    if (diagram) b.diagram = diagram;
    if (parent) attach(b.uid, parent, "last");
    seedChildren(b.uid, children);
    return b.uid;
  };

  return fake;
}
