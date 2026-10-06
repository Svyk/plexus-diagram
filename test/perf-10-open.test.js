// PERF-10: one board open reads cards, page rows, and badges without a pull per card.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";
import { buildBoard } from "../src/model/board.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import "../src/session-clip.js";
import "../src/views.js";

afterEach(() => resetSessions());

const ANCESTORS = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";
const HL_PROPS = { "pdf-highlight": { type: "text", content: { text: "x" }, position: { boundingRect: { pageNumber: 1 } } } };

function parseEntity(entity) {
  if (Array.isArray(entity)) return { key: entity[0], value: entity[1] };
  const match = /^\[\s*(:[\w/.-]+)\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(String(entity ?? ""));
  if (match) return { key: match[1], value: match[2] };
  return null;
}

function stripRefs(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripRefs);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === ":block/refs") continue;
    out[key] = stripRefs(value);
  }
  return out;
}

function countingHost() {
  const blocks = new Map();
  const pages = new Map();
  let eid = 10;
  const make = (uid, string, extra = {}) => {
    const node = {
      ":db/id": eid++,
      ":block/uid": uid,
      ":block/string": string,
      ":block/open": true,
      ":block/props": {},
      ":block/children": [],
      ...extra,
    };
    blocks.set(uid, node);
    if (typeof node[":node/title"] === "string") pages.set(node[":node/title"], node);
    return node;
  };
  for (let i = 0; i < 35; i++) {
    const row = make(`row${i}`, `row ${i}`);
    make(`b${i}`, `note ${i}`, { ":block/children": [row] });
  }
  for (let i = 0; i < 4; i++) {
    const rows = [0, 1, 2].map((r) => make(`p${i}r${r}`, `line ${i}.${r}`));
    make(`page${i}`, "", { ":node/title": `Page ${i}`, ":block/children": rows });
  }
  make("todo", "", { ":node/title": "TODO" });
  make("done", "", { ":node/title": "DONE" });
  const children = [];
  for (let i = 0; i < 35; i++) {
    children.push(make(`c${i}`, `((b${i}))`, { ":block/refs": [blocks.get(`b${i}`)] }));
  }
  for (let i = 0; i < 4; i++) {
    children.push(make(`pc${i}`, `[[Page ${i}]]`, { ":block/refs": [pages.get(`Page ${i}`)] }));
  }
  make("board", "{{[[diagram]]}}", {
    ":block/props": { plexus: { v: 2 } },
    ":block/children": children,
    ":block/parents": [{
      ":block/uid": "daily",
      ":block/string": "October 5th, 2026",
      ":block/props": {},
      ":block/parents": [{ ":db/id": 1 }],
    }],
  });

  const calls = [];
  const lookup = (entity) => {
    const parsed = parseEntity(entity);
    if (!parsed) return null;
    if (parsed.key === ":node/title") return pages.get(parsed.value) ?? null;
    if (parsed.key === ":block/uid") return blocks.get(parsed.value) ?? null;
    return null;
  };
  const pull = (pattern, entity) => {
    calls.push({ name: "pull" });
    const node = lookup(entity);
    if (!node) return null;
    const copy = structuredClone(node);
    return String(pattern).includes(":block/refs") ? copy : stripRefs(copy);
  };
  const query = (text, ...inputs) => {
    calls.push({ name: "q", text, inputs });
    if (String(text).includes("[?title ...]")) return [["Page 0", "mention1", "sees Page 0", "Daily"]];
    return [];
  };
  const watches = [];
  const data = {
    pull,
    q: query,
    fast: { q: query },
    addPullWatch(pattern, entity, cb) {
      calls.push({ name: "addPullWatch", pattern });
      watches.push({ pattern, entity, cb });
    },
    removePullWatch(pattern, entity, cb) {
      calls.push({ name: "removePullWatch" });
      const i = watches.findIndex((w) => w.cb === cb && w.entity === entity && w.pattern === pattern);
      if (i >= 0) watches.splice(i, 1);
    },
  };
  const host = createHost({ api: { data, util: { generateUID: () => "uid" } }, storage: new Map(), graph: "g" });
  const since = (start) => calls.slice(start);
  return { host, calls, since };
}

function targets() {
  const list = [];
  for (let i = 0; i < 35; i++) list.push({ kind: "block", uid: `b${i}` });
  for (let i = 0; i < 4; i++) list.push({ kind: "page", title: `Page ${i}` });
  return list;
}

test("one open of a 39-card board stays within 20 data calls and shares the board watch", () => {
  const { host, calls, since } = countingHost();
  const start = calls.length;
  host.api.data.pull("[:block/props]", [":block/uid", "board"]);
  host.api.data.pull(ANCESTORS, [":block/uid", "board"]);
  host.blockString("board");
  const pulled = host.pullBoard("board");
  assert.equal(pulled[":block/uid"], "board");
  const qBefore = since(start).filter((c) => c.name === "q").length;
  const refs = host.linkedRefs({ uid: "pc0", target: { kind: "page", title: "Page 0" } });
  assert.equal(since(start).filter((c) => c.name === "q").length, qBefore);
  assert.equal(refs[0].uid, "mention1");
  const offBoard = host.watchBoard("board", () => {});
  for (let i = 0; i < 35; i++) {
    assert.equal(host.blockString(`b${i}`), `note ${i}`);
    assert.equal(host.pullTree(`b${i}`, 2, 12).length, 1);
  }
  const pageOffs = [];
  for (let i = 0; i < 4; i++) {
    const outline = host.pageOutline(`Page ${i}`, 2000);
    assert.equal(outline.exists, true);
    assert.equal(outline.blocks.length, 3);
    pageOffs.push(host.watchPage(`Page ${i}`, () => {}));
    assert.equal(typeof host.pageUid(`Page ${i}`), "string");
  }
  const stats = host.cardStats(targets(), { boardUid: "board" });
  assert.equal(stats.get("page:Page 0").refs, 0);
  const opened = since(start);
  const adds = opened.filter((c) => c.name === "addPullWatch");
  assert.equal(adds.length, 1);
  assert.equal(adds[0].pattern.includes(":block/refs"), true);
  assert.ok(opened.length <= 20, `first open made ${opened.length} data calls`);
  const mid = calls.length;
  for (const off of pageOffs) off();
  assert.equal(since(mid).filter((c) => c.name === "removePullWatch").length, 0);
  offBoard();
  assert.equal(since(mid).filter((c) => c.name === "removePullWatch").length, 1);
});

test("thirty open and close cycles stay under the rate limit", () => {
  const { host, calls, since } = countingHost();
  let total = 0;
  for (let n = 0; n < 30; n++) {
    const start = calls.length;
    host.api.data.pull("[:block/props]", [":block/uid", "board"]);
    host.api.data.pull(ANCESTORS, [":block/uid", "board"]);
    host.blockString("board");
    host.pullBoard("board");
    const offBoard = host.watchBoard("board", () => {});
    for (let i = 0; i < 35; i++) {
      host.blockString(`b${i}`);
      host.pullTree(`b${i}`);
    }
    const pageOffs = [];
    for (let i = 0; i < 4; i++) {
      host.pageOutline(`Page ${i}`, 2000);
      pageOffs.push(host.watchPage(`Page ${i}`, () => {}));
      host.pageUid(`Page ${i}`);
    }
    host.cardStats(targets(), { boardUid: "board" });
    for (const off of pageOffs) off();
    offBoard();
    const used = since(start).length;
    assert.ok(used <= 20, `cycle ${n} made ${used} data calls`);
    total += used;
  }
  assert.ok(total < 1500, `30 cycles made ${total} data calls`);
});

test("buildBoard reads a highlight from the pulled ref", () => {
  let resolves = 0;
  let propsReads = 0;
  const board = buildBoard({
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]}}",
    ":block/children": [{
      ":block/uid": "c1",
      ":block/string": "((hl01))",
      ":block/order": 0,
      ":block/refs": [{
        ":block/uid": "hl01",
        ":block/string": "text #h/yellow",
        ":block/props": HL_PROPS,
        ":block/page": { ":node/title": "p.pdf" },
      }],
    }],
  }, {
    resolve() { resolves += 1; return "nope"; },
    propsOf() { propsReads += 1; return null; },
  });
  assert.equal(resolves, 0);
  assert.equal(propsReads, 0);
  assert.equal(board.items.get("c1").kind, "highlight");
  assert.equal(board.items.get("c1").highlight.text, "x");
});

test("a covered highlight does not add its own watch", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const watches = [];
  let props = 0;
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{ uid: "c1", string: "((hl01))", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }],
  });
  const readString = host.blockString.bind(host);
  host.blockString = (id) => (id === "hl01" ? "text #h/yellow" : readString(id));
  host.blockProps = () => {
    props += 1;
    return { props: HL_PROPS, string: "text #h/yellow", pageTitle: "p.pdf" };
  };
  host.coversBlock = () => true;
  host.watchBlock = (id) => { watches.push(id); return () => {}; };
  const session = acquireSession("b1", { host, linkDelay: 0, raf: (fn) => fn(), settings: { "graph-links": "off" } });
  assert.equal(session.board.items.get("c1").kind, "highlight");
  assert.equal(props, 1);
  assert.deepEqual(watches, []);
});
