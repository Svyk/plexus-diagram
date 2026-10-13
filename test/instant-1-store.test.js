// INSTANT-1: the open snapshot model (sanitize, pack, caps) and its IndexedDB store.
import assert from "node:assert/strict";
import test from "node:test";

import {
  SNAP_MAX_BYTES,
  SNAP_MAX_ITEMS,
  SNAP_MAX_BOXES,
  SNAP_VERSION,
  buildFace,
  captureFace,
  itemSig,
  packSnapshot,
  parseSnapshot,
  tableGrid,
} from "../src/model/boardsnap.js";
import { SNAP_DB, SNAP_DB_VERSION, createBoardSnapStore } from "../src/host/boardsnap-store.js";
import { DIAGRAM_DB } from "../src/host/diagram-db.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";

const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

function snapOf(uid, items, extra = {}) {
  return {
    v: SNAP_VERSION,
    uid,
    stamp: "s1",
    savedAt: 1,
    height: 560,
    width: 800,
    vp: { x: 0, y: 0, zoom: 1 },
    rootCls: "pxd-root pxd-root--light pxd-root--gesturing",
    rootStyle: { "--pxd-map-font": "14px", color: "red", "--pxd-x": "url(javascript:alert(1))" },
    items,
    ...extra,
  };
}

function card(uid, face = null, extra = {}) {
  return { uid, section: false, x: 10, y: 20, w: 200, h: 100, cls: "pxd-item pxd-item--card pxd-item--note pxd-item--selected", sig: "abc", face, ...extra };
}

test("a face keeps whitelisted tags, classes and text; scripts, handlers and unsafe values are dropped", () => {
  const stub = createDomStub();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-item__body";
  const ok = doc.createElement("span");
  ok.className = "rm-block-main bad<class";
  ok.textContent = "Hello";
  const script = doc.createElement("script");
  script.textContent = "alert(1)";
  const link = doc.createElement("a");
  link.setAttribute("href", "javascript:alert(1)");
  link.setAttribute("onclick", "alert(1)");
  link.setAttribute("data-link-uid", "abc");
  link.textContent = "Link";
  const img = doc.createElement("img");
  img.setAttribute("src", "javascript:alert(1)");
  const good = doc.createElement("img");
  good.setAttribute("src", "https://example.test/a.png");
  root.append(ok, script, link, img, good);
  const thumbs = new Map();
  const face = captureFace(root, { thumbs });
  const json = JSON.stringify(face);
  assert.ok(!json.includes("alert"), json);
  assert.ok(!json.includes("script"));
  assert.ok(!json.includes("bad<class"));
  assert.equal(face.k[0].c, "rm-block-main");
  assert.equal(face.k[0].k[0], "Hello");
  assert.equal(face.k[1].t, "span", "a link reads as a span");
  assert.equal(face.k[2].s, "https://example.test/a.png");

  // A tampered stored face goes through the whitelist again on build.
  const built = buildFace(doc, {
    t: "div",
    c: "x",
    a: { onclick: "alert(1)", "data-ok": "1", style: "x" },
    k: [{ t: "script", k: ["alert(1)"] }, { t: "img", s: "javascript:alert(1)" }, { t: "iframe" }, "text", { t: "img", s: "@missing" }],
  });
  assert.equal(built.getAttribute("onclick"), null);
  assert.equal(built.getAttribute("data-ok"), "1");
  assert.equal(built.children.length, 1, "only the text node survives");
});

test("a data: cover moves to the thumb table and comes back on build", () => {
  const stub = createDomStub();
  const doc = stub.document;
  const el = doc.createElement("div");
  el.className = "pxd-pdf-cover";
  const data = `data:image/jpeg;base64,${"A".repeat(400)}`;
  el.style["--pxd-cover"] = `url("${data}")`;
  const thumbs = new Map();
  const face = captureFace(el, { thumbs });
  const ref = face.y["--pxd-cover"];
  assert.ok(ref.startsWith("@d:"));
  assert.equal(thumbs.get(ref.slice(1)), data);
  const built = buildFace(doc, face, { thumbs });
  assert.equal(built.style["--pxd-cover"], `url("${data}")`);
});

test("pack drops layers, then faces, to stay under 300 KB; over SNAP_MAX_BOXES items is not cached", () => {
  const big = { t: "div", c: "pxd-item__body", k: ["x".repeat(16000)] };
  const items = [];
  for (let i = 0; i < 40; i += 1) items.push(card(`c${i}`, { t: "div", k: [big] }));
  const packed = packSnapshot(snapOf("b1", items, { edges: { t: "svg", k: ["y".repeat(70000)] } }));
  assert.ok(packed.length <= SNAP_MAX_BYTES);
  const back = parseSnapshot(packed);
  assert.equal(back.items.length, 40, "every card keeps its place");
  assert.equal(back.edges, null, "the edge layer went first");
  assert.ok(back.items.some((item) => !item.face), "tail faces dropped");
  assert.ok(back.items[0].face, "head faces kept");
  assert.equal(back.rootCls, "pxd-root pxd-root--light", "transient root classes dropped");
  assert.deepEqual(back.rootStyle, { "--pxd-map-font": "14px" });
  assert.equal(back.items[0].cls, "pxd-item pxd-item--card pxd-item--note", "transient shell classes dropped");

  const many = [];
  for (let i = 0; i < SNAP_MAX_BOXES + 1; i += 1) many.push(card(`m${i}`));
  assert.equal(packSnapshot(snapOf("b2", many)), null);
  // A board past SNAP_MAX_ITEMS is cached: its byte cap grows with the boxes.
  const mid = [];
  for (let i = 0; i < SNAP_MAX_ITEMS * 3; i += 1) mid.push(card(`n${i}`));
  const packedMid = packSnapshot(snapOf("b3", mid));
  assert.ok(packedMid);
  assert.equal(parseSnapshot(packedMid).items.length, SNAP_MAX_ITEMS * 3);
  assert.equal(parseSnapshot("{"), null);
  assert.equal(parseSnapshot(JSON.stringify({ v: 99, items: [] })), null);
});

test("item sig follows the string and the outline; table cells are first-child chains", () => {
  const item = {
    uid: "t1",
    type: "card",
    kind: "note",
    string: "{{[[table]]}}",
    content: [
      { ":block/string": "Name", ":block/order": 0, ":block/children": [{ ":block/string": "Count" }] },
      { ":block/string": "[[Alpha]]", ":block/order": 1, ":block/children": [{ ":block/string": "**3**" }] },
    ],
  };
  const a = itemSig(item);
  assert.equal(a, itemSig({ ...item }));
  assert.notEqual(a, itemSig({ ...item, content: [...item.content, { ":block/string": "x" }] }));
  assert.deepEqual(tableGrid(item), [["Name", "Count"], ["Alpha", "3"]]);
});

test("store: set serves the next get at once, writes after the debounce, and a new store warms it back", async () => {
  const idb = createFakeIDB();
  const store = createBoardSnapStore({ indexedDB: idb, graph: "g", debounceMs: 0, idle: (fn) => fn() });
  await store.ready;
  const thumbs = new Map([["d:1", "data:image/png;base64,AAAA"]]);
  const face = { t: "div", k: [{ t: "div", c: "pxd-item__body", k: [{ t: "img", s: "@d:1" }] }] };
  assert.equal(store.set("b1", snapOf("b1", [card("c1", face)]), thumbs), true);
  assert.equal(store.get("b1").items[0].uid, "c1");
  assert.equal(store.thumb("d:1"), "data:image/png;base64,AAAA");
  await tick(20);
  await store.flush();
  await store.dispose();

  const again = createBoardSnapStore({ indexedDB: idb, graph: "g" });
  assert.equal(again.get("b1"), null, "nothing until the warm read lands");
  await again.ready;
  assert.equal(again.get("b1").items[0].face.k[0].k[0].s, "@d:1");
  await again.thumbsReady;
  assert.equal(again.thumb("d:1"), "data:image/png;base64,AAAA");
  const otherGraph = createBoardSnapStore({ indexedDB: idb, graph: "h" });
  await otherGraph.ready;
  assert.equal(otherGraph.get("b1"), null, "snapshots are per graph");
  await again.dispose();
  await otherGraph.dispose();
});

test("store: the in-memory LRU holds 20 boards; the oldest falls out first", async () => {
  const store = createBoardSnapStore({ indexedDB: null, graph: "g", lruSize: 20 });
  for (let i = 0; i < 21; i += 1) store.set(`b${i}`, snapOf(`b${i}`, [card(`c${i}`)]));
  assert.equal(store.size(), 20);
  assert.equal(store.get("b0"), null);
  assert.ok(store.get("b1"));
  store.set("b21", snapOf("b21", [card("c21")]));
  assert.ok(store.get("b1"), "a read makes b1 recent");
  assert.equal(store.get("b2"), null);
  await store.dispose();
});

test("store: off by flag reads and writes nothing", async () => {
  const idb = createFakeIDB();
  let on = false;
  const store = createBoardSnapStore({ indexedDB: idb, graph: "g", enabled: () => on, debounceMs: 0, idle: (fn) => fn() });
  await store.ready;
  assert.equal(store.set("b1", snapOf("b1", [card("c1")])), false);
  assert.equal(store.get("b1"), null);
  assert.deepEqual(idb.opens, []);
  on = true;
  await store.dispose();
});

test("store: only its own database, at version 1; the shared plexus-diagram database is never opened", async () => {
  const idb = createFakeIDB();
  const store = createBoardSnapStore({ indexedDB: idb, graph: "g", debounceMs: 0, idle: (fn) => fn() });
  await store.ready;
  store.set("b1", snapOf("b1", [card("c1")]));
  await tick(10);
  await store.flush();
  await store.load("zzz");
  await store.dispose();
  assert.ok(idb.opens.length >= 1);
  for (const [name, version] of idb.opens) {
    assert.equal(name, SNAP_DB);
    assert.equal(version, SNAP_DB_VERSION);
    assert.notEqual(name, DIAGRAM_DB);
  }
  assert.equal(idb.dbs.has(DIAGRAM_DB), false);
  assert.equal(idb.dbs.get(SNAP_DB).version, 1);
});

test("store: dispose still lands a pending write", async () => {
  const idb = createFakeIDB();
  const store = createBoardSnapStore({ indexedDB: idb, graph: "g", debounceMs: 60000, idle: (fn) => fn() });
  await store.ready;
  store.set("b9", snapOf("b9", [card("c9")]));
  await store.dispose();
  const again = createBoardSnapStore({ indexedDB: idb, graph: "g" });
  await again.ready;
  assert.ok(again.get("b9"));
  await again.dispose();
});

test("packing a big snapshot over the cap stringifies it a few times, not once per face", () => {
  const items = [];
  for (let i = 0; i < 1500; i += 1) items.push(card(`p${i}`, { t: "div", k: ["face text ".repeat(40)] }));
  const real = JSON.stringify;
  let chars = 0;
  JSON.stringify = (...args) => { const out = real(...args); chars += out?.length || 0; return out; };
  let packed;
  try { packed = packSnapshot(snapOf("b4", items)); } finally { JSON.stringify = real; }
  assert.ok(packed);
  assert.ok(chars < packed.length * 12, `stringified ${chars} chars for a ${packed.length}-char snapshot`);
});
