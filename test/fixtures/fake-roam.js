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

export function createFakeRoam({ echoDelay = 5, writeDelay = 0, echoMode = "fresh", hash = "#/app/testgraph" } = {}) {
  const blocks = new Map(); // uid -> {uid,string,order,heading,open,props,children[],parent,eid,diagram?}
  const pages = new Map(); // uid -> {uid,title,children[],eid}
  const watches = []; // {pattern, entity, cb, uid}
  const timers = new Set();
  let eidCounter = 100;
  let uidCounter = 0;
  let qHandler = () => [];

  const fake = {
    echoDelay,
    writeDelay,
    echoMode, // "fresh": echo carries the state at fire time; "snapshot": state right after that write
    log: [],
    calls: [],
    failNext: 0,
    hash,
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

  function pull(pattern, entity) {
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

  function notify(uid, before, chainBefore = []) {
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
        fn();
        fake.log.push(logEntry);
        notify(uid, before, chainBefore);
        resolve();
      };
      if (fake.writeDelay > 0) schedule(run, fake.writeDelay);
      else run();
    });
  }

  const api = {
    util: { generateUID: () => fake.generateUid() },
    data: {
      pull,
      q: (...args) => qHandler(...args),
      fast: { q: (...args) => qHandler(...args) },
      addPullWatch(pattern, entity, cb) {
        const { value } = parseEntity(entity);
        watches.push({ pattern, entity, cb, uid: value });
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
      },
      page: {
        create({ page }) {
          return write(page.uid ?? page.title, () => {
            const uid = page.uid ?? fake.generateUid();
            pages.set(uid, { uid, title: page.title, children: [], eid: ++eidCounter });
          }, ["page-create", page.uid ?? "?", page.title]);
        },
      },
      undo() { fake.calls.push(["undo"]); return Promise.resolve(); },
      redo() { fake.calls.push(["redo"]); return Promise.resolve(); },
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
  fake.generateUid = () => `gen${String(++uidCounter).padStart(6, "0")}`;
  fake.setQ = (fn) => { qHandler = fn; };
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
