// PXD-22: `{{diagram ((uid))}}` is a Plexus board that follows that block (or query). Roam draws it as a plain button.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { followKind } from "../src/host/follow-sources.js";
import { DIAGRAM_SELECTOR, REF_BUTTON_SELECTOR, diagramsWithin, enhancedUidGuardCss } from "../src/discovery.js";
import { buildBoard } from "../src/model/board.js";
import { boardPath } from "../src/model/board-path.js";
import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { boardLabel, parseBoardRef, parseBoardTitle, setBoardTitle, UNTITLED_BOARD } from "../src/model/schema.js";
import { boardRefSource, readFollow, textSourceUid } from "../src/model/follow.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ---------------------------------------------------------------- model

test("PXD-22 parseBoardRef: leading token only, with or without colon, brackets and title", () => {
  assert.deepEqual(parseBoardRef("{{diagram ((abc123XYZ))}}"), { uid: "abc123XYZ", title: "", colon: false });
  assert.deepEqual(parseBoardRef("{{[[diagram]] ((abc123XYZ))}}"), { uid: "abc123XYZ", title: "", colon: false });
  assert.deepEqual(parseBoardRef("{{diagram: ((abc123XYZ))}}"), { uid: "abc123XYZ", title: "", colon: true });
  assert.deepEqual(parseBoardRef("{{[[diagram]]: ((abc123XYZ))}}"), { uid: "abc123XYZ", title: "", colon: true });
  assert.deepEqual(parseBoardRef("{{diagram ((abc123XYZ)) Reading list}}"), { uid: "abc123XYZ", title: "Reading list", colon: false });
  assert.deepEqual(parseBoardRef("{{[[diagram]]: ((abc123XYZ)) Reading list}}"), { uid: "abc123XYZ", title: "Reading list", colon: true });
  assert.deepEqual(parseBoardRef("{{diagram ((abc123XYZ))}} and more ((zzz))"), { uid: "abc123XYZ", title: "", colon: false }, "text after }} is ignored");
  assert.deepEqual(parseBoardRef("{{Diagram ((x))}}"), { uid: "x", title: "", colon: false });
  assert.deepEqual(parseBoardRef("{{diagram ((ab-cd-12))}}"), { uid: "ab-cd-12", title: "", colon: false });
  assert.equal(parseBoardRef("{{[[diagram]]:Plain title}}"), null);
  assert.equal(parseBoardRef("{{[[diagram]]}}"), null);
  assert.equal(parseBoardRef("{{diagram foo}}"), null);
  assert.equal(parseBoardRef(null), null);
});

test("PXD-22 parseBoardTitle: colon forms as before, the no-colon ref form gives its trailing title", () => {
  assert.equal(parseBoardTitle("{{[[diagram]]: ((abc123XYZ))}}"), "((abc123XYZ))");
  assert.equal(parseBoardTitle("{{[[diagram]]:Plain title}}"), "Plain title");
  assert.equal(parseBoardTitle("{{diagram ((abc123XYZ))}}"), "");
  assert.equal(parseBoardTitle("{{[[diagram]] ((abc123XYZ))}}"), "");
  assert.equal(parseBoardTitle("{{diagram ((abc123XYZ)) Reading list}}"), "Reading list");
  assert.equal(parseBoardTitle("{{Diagram ((x)) T}} tail"), "T");
});

test("PXD-22 setBoardTitle keeps the ref in the no-colon form and the spelling; colon forms are unchanged", () => {
  assert.equal(setBoardTitle("{{diagram ((x))}}", "New"), "{{diagram ((x)) New}}");
  assert.equal(setBoardTitle("{{[[diagram]] ((x)) Old}} tail", "New"), "{{[[diagram]] ((x)) New}} tail");
  assert.equal(setBoardTitle("{{diagram ((x)) Old}}", ""), "{{diagram ((x))}}");
  assert.equal(setBoardTitle("{{[[diagram]]:Old}} tail", "New"), "{{[[diagram]]:New}} tail");
  assert.equal(setBoardTitle("{{[[diagram]]: ((x))}}", "New"), "{{[[diagram]]:New}}");
  assert.equal(setBoardTitle("{{[[diagram]]}}", "New"), "{{[[diagram]]:New}}");
});

test("PXD-22 boardRefSource: the no-colon ref form, or the colon form with only the ref; textSourceUid is the same", () => {
  for (const s of ["{{diagram ((abc123XYZ))}}", "{{[[diagram]] ((abc123XYZ))}}", "{{diagram: ((abc123XYZ))}}", "{{[[diagram]]: ((abc123XYZ))}}", "{{diagram ((abc123XYZ)) Reading list}}", "{{Diagram ((abc123XYZ))}} tail"]) {
    assert.equal(boardRefSource(s), "abc123XYZ", s);
    assert.equal(textSourceUid(s), "abc123XYZ", s);
  }
  for (const s of ["{{[[diagram]]: ((abc123XYZ)) Reading list}}", "{{[[diagram]]:Plain title}}", "{{[[diagram]]}}", "{{diagram foo}}", ""]) {
    assert.equal(boardRefSource(s), null, s);
  }
  assert.equal(boardRefSource("{{diagram ((ab-cd-12))}}"), "ab-cd-12");
});

test("PXD-22 boardLabel: never a raw ((uid)); the referenced block's first line fills an empty or bare-ref title", () => {
  const blocks = { SRC000001: "**Reading** list\nsecond line", EMPTY0001: "" };
  const resolve = (id) => (id in blocks ? blocks[id] : null);
  assert.equal(boardLabel("{{diagram ((SRC000001))}}", resolve), "Reading list");
  assert.equal(boardLabel("{{[[diagram]]: ((SRC000001))}}", resolve), "Reading list");
  assert.equal(boardLabel("{{diagram ((SRC000001)) Mine}}", resolve), "Mine");
  assert.equal(boardLabel("{{[[diagram]]: ((SRC000001)) and more}}", resolve), "Reading list and more");
  assert.equal(boardLabel("{{diagram ((NOPE00001))}}", resolve), UNTITLED_BOARD);
  assert.equal(boardLabel("{{[[diagram]]: ((NOPE00001)) tail}}", resolve), "tail");
  assert.equal(boardLabel("{{diagram ((EMPTY0001))}}", resolve), UNTITLED_BOARD);
  assert.equal(boardLabel("{{diagram ((SRC000001))}}"), UNTITLED_BOARD);
  assert.equal(boardLabel("{{[[diagram]]:Plain}}", resolve), "Plain");
  assert.equal(boardLabel("{{[[diagram]]}}", resolve), UNTITLED_BOARD);
});

// ---------------------------------------------------------------- session

function setup({ string = "{{diagram ((SRC000001))}}", props, srcString = "Source block", cards = [] } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [
    { uid: "SRC000001", string: srcString, children: [
      { uid: "k1", string: "one", children: [{ uid: "g1", string: "grandchild" }] },
      { uid: "k2", string: "two" },
    ] },
    { uid: "QRY000001", string: "{{[[query]]: [[Lab]]}}" },
  ] });
  fake.seedBoard({ uid: "b1", string, ...(props ? { props } : {}), children: cards });
  const session = acquireSession("b1", { host, settings: null, virtual: true, linkDelay: 0 });
  return { fake, host, session };
}

test("PXD-22 open writes nothing: the pointer is derived, the block read returns the tree", async () => {
  const { fake, host, session } = setup();
  await flush();
  await fake.flush();
  assert.deepEqual(fake.writesLog(), []);
  const state = session.followState();
  assert.equal(state.pointer.kind, "block");
  assert.equal(state.pointer.uid, "SRC000001");
  assert.equal(state.pointer.tree, true);
  assert.equal(state.followDerived, true);
  assert.equal(session.board.virtual, true);
  const got = await followKind("block").read(state.pointer, { host, boardUid: "b1", inBoard: () => session.followExclude(), tick: () => Promise.resolve() });
  assert.equal(got.ok, true);
  assert.deepEqual(got.items.map((i) => i.uid).sort(), ["g1", "k1", "k2"]);
  assert.deepEqual(fake.writesLog(), [], "and the read writes nothing");
});

test("PXD-22 first edit: Place all stamps v:2 and the pointer, writes the cards after it, and the pointer is stored", async () => {
  const { fake, host, session } = setup();
  await flush();
  const state = session.followState();
  const got = await followKind("block").read(state.pointer, { host, boardUid: "b1", inBoard: () => session.followExclude(), tick: () => Promise.resolve() });
  fake.clearLog();
  const res = await session.placeFollowed(got.items.map((i) => ({ uid: i.uid, kind: i.kind })));
  await fake.flush();
  assert.equal(res.placed, 3);
  const log = fake.writesLog();
  assert.equal(log[0][0], "update", "the board props go first");
  assert.equal(log[0][1], "b1");
  assert.deepEqual(fake.props("b1").plexus, { v: 2, follow: { kind: "block", uid: "SRC000001", tree: true } });
  for (const id of res.uids) assert.equal(fake.props(id).plexus.src, "block:SRC000001");
  await flush();
  const after = session.followState();
  assert.equal(after.followDerived, false, "stored now: nothing is derived any more");
  assert.deepEqual(readFollow(session.board.plexus), { kind: "block", uid: "SRC000001", tree: true, skip: [] });
});

test("PXD-22 Stop following on a virtual ref board writes {v:2} and the pointer never comes back", async () => {
  const { fake, session } = setup();
  await flush();
  fake.clearLog();
  assert.equal(await session.stopFollowing(), true);
  await fake.flush();
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
  await flush();
  assert.equal(session.followState(), null);
  session.refresh?.();
  await flush();
  assert.equal(session.followState(), null);
});

test("PXD-22 session.enhance on a virtual ref board writes the marker with the pointer", async () => {
  const { fake, session } = setup();
  await flush();
  fake.clearLog();
  await session.enhance();
  await fake.flush();
  assert.deepEqual(fake.props("b1").plexus, { v: 2, follow: { kind: "block", uid: "SRC000001", tree: true } });
});

test("PXD-22 setFollowTree off on a virtual ref board writes the stamp and the pointer in one props write", async () => {
  const { fake, session } = setup();
  await flush();
  fake.clearLog();
  assert.equal(await session.setFollowTree(false), true);
  await fake.flush();
  assert.deepEqual(fake.props("b1").plexus, { v: 2, follow: { kind: "block", uid: "SRC000001" } });
});

test("PXD-22 query ref: a derived query pointer with no tree, no writes, and the query read returns the tagged blocks", async () => {
  const { fake, session } = setup({ string: "{{diagram ((QRY000001))}}" });
  await flush();
  await fake.flush();
  assert.deepEqual(fake.writesLog(), []);
  const state = session.followState();
  assert.deepEqual([state.pointer.kind, state.pointer.uid, state.pointer.tree, state.followDerived], ["query", "QRY000001", undefined, true]);
  const strings = { QRY000001: "{{[[query]]: [[Lab]]}}", T00000001: "first #Lab", T00000002: "second [[Lab]]" };
  const queryHost = {
    pullEntity(pattern, uid) {
      if (pattern === "[:block/string]") return strings[uid] ? { ":block/string": strings[uid] } : null;
      if (uid === "QRY000001") return { ":block/uid": uid, ":block/string": strings[uid], ":edit/time": 1, ":block/children": [] };
      return null;
    },
    q(query, ...inputs) {
      if (query.includes("(count ?r)")) return [[2]];
      if (query.includes("(count ?b)")) return [[0]];
      if (query.includes(":block/parents ?r")) return [];
      if (query.includes("[?r :block/uid ?u]")) return [["T00000001"], ["T00000002"]];
      if (query.includes(":block/string \"\"")) return inputs[0].map((u) => [u, strings[u], "", 100]);
      if (query.includes(":edit/time 0) ?t]]")) return inputs[0].map((u, i) => [u, 100 + i]);
      return [];
    },
  };
  const got = await followKind("query").read(state.pointer, { host: queryHost, inBoard: () => new Set(), tick: () => Promise.resolve() });
  assert.equal(got.ok, true);
  assert.deepEqual(got.items.map((i) => i.uid).sort(), ["T00000001", "T00000002"]);
});

test("PXD-22 missing ref: a derived block pointer whose read says missing; no writes, no throw", async () => {
  const { fake, host, session } = setup({ string: "{{diagram ((NOPE00001))}}" });
  await flush();
  await fake.flush();
  assert.deepEqual(fake.writesLog(), []);
  const state = session.followState();
  assert.deepEqual([state.pointer.kind, state.pointer.uid, state.followDerived], ["block", "NOPE00001", true]);
  const got = await followKind("block").read(state.pointer, { host, boardUid: "b1", inBoard: () => new Set(), tick: () => Promise.resolve() });
  assert.deepEqual(got, { ok: false, reason: "missing" });
});

test("PXD-22 no derivation on a stamped board, a colon-title board, or one that already stores a pointer", async () => {
  const stamped = setup({ props: { plexus: { v: 2 } } });
  await flush();
  assert.equal(stamped.session.followState(), null);
  resetSessions();
  const titled = setup({ string: "{{[[diagram]]: ((SRC000001)) Reading list}}" });
  await flush();
  assert.equal(titled.session.followState(), null);
  resetSessions();
  const stored = setup({ props: { plexus: { follow: { kind: "query", uid: "QRY000001" } } } });
  await flush();
  const s = stored.session.followState();
  assert.equal(s.pointer.kind, "query");
  assert.equal(s.followDerived, false);
  resetSessions();
  const plain = setup({ string: "{{[[diagram]]:Plain}}" });
  await flush();
  assert.equal(plain.session.followState(), null);
});

test("PXD-22 the board title shows the source's first line, not the raw ref", async () => {
  const { session } = setup({ srcString: "Reading list" });
  await flush();
  assert.equal(session.board.title, "Reading list");
});

// ---------------------------------------------------------------- tray

function mountTray(opts) {
  const f = setup(opts);
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = {
    later: () => () => {},
    bgIdle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); },
    idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); },
  };
  const tray = createFollowTray({ doc: dom.document, root, host: f.host, session: f.session, timers, board: () => f.session.board, storage: f.fake.storage, graph: "g" });
  return { ...f, root, tray };
}

test("PXD-22 tray: a derived pointer on an empty board opens the panel on its own, once", async () => {
  const f = mountTray();
  await flush();
  assert.equal(f.tray.isOpen(), true);
  assert.ok(f.root.querySelector(".pxd-follow__panel"));
  f.tray.close();
  f.session.allowVirtual?.();
  await flush();
  assert.equal(f.tray.isOpen(), false, "closed by the user: not opened again");
  f.tray.dispose();
});

test("PXD-22 tray: a stored pointer, or a derived one on a board with cards, does not open by itself", async () => {
  const stored = mountTray({ props: { plexus: { v: 2, follow: { kind: "block", uid: "SRC000001" } } } });
  await flush();
  assert.equal(stored.tray.isOpen(), false);
  stored.tray.dispose();
  resetSessions();
  const withCards = mountTray({ cards: [{ uid: "n1", string: "Note", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }] });
  await flush();
  assert.equal(withCards.tray.isOpen(), false);
  withCards.tray.dispose();
});

test("PXD-22 tray: a missing text source shows the clear empty state", async () => {
  const f = mountTray({ string: "{{diagram ((NOPE00001))}}" });
  await flush(12);
  assert.equal(f.tray.isOpen(), true);
  const text = f.root.querySelector(".pxd-follow__panel").textContent;
  assert.match(text, /The block in the board text does not exist\./);
  assert.match(text, /a block that does not exist/);
  assert.doesNotMatch(text, /Untitled/);
  f.tray.dispose();
});

// ---------------------------------------------------------------- discovery

test("PXD-22 discovery: diagramsWithin finds the ref button, and the guard hides it before mount", () => {
  const dom = createDomStub();
  const block = dom.document.createElement("div");
  const button = dom.document.createElement("button");
  button.className = "bp3-button bp3-small dont-focus-block rm-xparser-default-diagram ((pxd22Src1))";
  const other = dom.document.createElement("button");
  other.className = "bp3-button";
  const native = dom.document.createElement("div");
  native.className = "rm-diagram";
  block.append(button, other, native);
  dom.document.body.append(block);
  const found = diagramsWithin(block);
  assert.ok(found.includes(button) && found.includes(native) && !found.includes(other));
  assert.deepEqual(diagramsWithin(button), [button]);
  assert.equal(REF_BUTTON_SELECTOR, "button.rm-xparser-default-diagram");
  assert.ok(DIAGRAM_SELECTOR.includes(".rm-diagram") && DIAGRAM_SELECTOR.includes(REF_BUTTON_SELECTOR));
  const css = enhancedUidGuardCss(["pxd22Src1"]);
  assert.ok(css.includes('[id$="pxd22Src1"] button.rm-xparser-default-diagram:not(.pxd-native-hidden):not(.pxd-outline-native)'));
});

// ---------------------------------------------------------------- round 2

test("PXD-22 parseBoardRef: one level of nested {{macro}} stays in the title", () => {
  assert.deepEqual(parseBoardRef("{{diagram ((abc)) {{x}}}}"), { uid: "abc", title: "{{x}}", colon: false });
  assert.equal(setBoardTitle("{{diagram ((abc)) {{x}}}} tail", "New"), "{{diagram ((abc)) New}} tail");
});

test("PXD-22 buildBoard: nested ref board cards get the referenced block's first line as the title", () => {
  const pulled = {
    ":block/uid": "parent001",
    ":block/string": "{{[[diagram]]:Parent}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      { ":block/uid": "ca000001", ":block/string": "{{diagram ((SRC000001))}}", ":block/order": 0 },
      { ":block/uid": "cb000001", ":block/string": "{{[[diagram]]: ((SRC000001))}}", ":block/order": 1 },
    ],
  };
  const resolve = (id) => (id === "SRC000001" ? "Reading list" : null);
  const board = buildBoard(pulled, { resolve });
  const titles = ["ca000001", "cb000001"].map((id) => board.items.get(id)?.title);
  assert.deepEqual(titles, ["Reading list", "Reading list"]);
});

test("PXD-22 boardPath: an ancestor ref board shows the referenced block's first line", () => {
  const parents = [{
    ":block/uid": "anc000001",
    ":block/string": "{{[[diagram]]: ((SRC000001))}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/parents": [{ ":db/id": 1 }],
  }];
  const resolve = (id) => (id === "SRC000001" ? "Reading list" : null);
  const path = boardPath(parents, { uid: "leaf00001", title: "Leaf" }, resolve);
  assert.deepEqual(path, [{ uid: "anc000001", title: "Reading list" }, { uid: "leaf00001", title: "Leaf" }]);
  assert.equal(boardPath(parents, { uid: "leaf00001", title: "Leaf" })[0].title, UNTITLED_BOARD);
});

test("PXD-22 self-reference: a board whose string refs itself derives no pointer", async () => {
  const { fake, session } = setup({ string: "{{diagram ((b1))}}" });
  await flush();
  await fake.flush();
  assert.equal(session.followState(), null);
  assert.deepEqual(fake.writesLog(), []);
});

// feature.consider, button branch: a DOM stub under the real installPlexusDiagram.
class El {
  constructor(doc, tag = "div") {
    Object.assign(this, { doc, tag, children: [], parentElement: null, nodeType: 1, style: { display: "" }, dataset: {}, id: "", textContent: "", cls: new Set(), closestMap: {}, attrs: new Map() });
    const cls = this.cls;
    this.classList = { add: (...n) => n.forEach((x) => cls.add(x)), remove: (...n) => n.forEach((x) => cls.delete(x)), contains: (n) => cls.has(n) };
  }
  get tagName() { return this.tag.toUpperCase(); }
  get previousElementSibling() { const sib = this.parentElement?.children; return sib ? sib[sib.indexOf(this) - 1] ?? null : null; }
  addEventListener() {}
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  set className(value) { this.cls.clear(); String(value).split(/\s+/).filter(Boolean).forEach((n) => this.cls.add(n)); }
  get className() { return [...this.cls].join(" "); }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === this.doc.root; }
  append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
  appendChild(child) { this.append(child); return child; }
  after(node) { node.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this) + 1, 0, node); node.parentElement = p; }
  remove() { const p = this.parentElement; if (!p) return; p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; }
  closest(selector) { return this.closestMap[selector] ?? null; }
  matches(selector) {
    if (selector === "*") return true;
    if (selector === '[id^="block-input-"]') return this.id.startsWith("block-input-");
    if (selector === REF_BUTTON_SELECTOR) return this.tag === "button" && this.cls.has("rm-xparser-default-diagram");
    return selector.startsWith(".") && this.cls.has(selector.slice(1));
  }
  contains(node) { for (let c = node; c; c = c.parentElement) if (c === this) return true; return false; }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) { if (child.matches(selector)) out.push(child); out.push(...child.querySelectorAll(selector)); }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

async function withButtonEnv(blockString, fn) {
  const globals = ["document", "window", "location", "MutationObserver", "setInterval", "clearInterval"];
  const saved = {};
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = {};
  doc.root = new El(doc, "html"); doc.head = new El(doc, "head"); doc.body = new El(doc, "body"); doc.app = new El(doc, "div");
  doc.app.cls.add("roam-app");
  doc.root.append(doc.head); doc.root.append(doc.body); doc.body.append(doc.app);
  doc.addEventListener = () => {}; doc.removeEventListener = () => {};
  doc.createElement = (tag) => new El(doc, tag);
  doc.getElementById = (id) => doc.root.querySelectorAll("*").find((n) => n.id === id) ?? null;
  doc.querySelector = (sel) => doc.root.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.root.querySelectorAll(sel);
  const intervals = new Map();
  let nextId = 1;
  define("document", doc);
  define("window", { addEventListener() {}, removeEventListener() {} });
  define("location", { hash: "" });
  define("MutationObserver", class { observe() {} disconnect() {} });
  define("setInterval", (cb) => { const id = nextId++; intervals.set(id, cb); return id; });
  define("clearInterval", (id) => intervals.delete(id));
  const uid = "refBtn001";
  const host = {
    api: { data: { pull: (pattern, ref) => (pattern === "[:block/props]" ? { ":block/props": { ":plexus": { ":v": 2 } } } : pattern.startsWith("[:block/open") ? null : null), }, ui: { getFocusedBlock: () => null } },
    stats: { writes: 0, watches: 0, renders: 0 },
    pullNative: () => null,
    pageUid: () => null,
    blockString: (id) => (id === uid ? blockString : null),
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async () => "x", openBlock: async () => {}, openPage: async () => {}, setOpen: async () => {},
  };
  const views = [];
  const mountView = (args) => { const v = { args, dispose() {}, setFullscreen() {}, focusUid() {} }; views.push(v); return v; };
  const acquireSession = (id) => ({ uid: id, board: { enhanced: true }, on: () => () => {}, release() {} });
  const reg = { addCommand: async () => {}, removeCommand: async () => {} };
  const extensionAPI = {
    settings: { get: (id) => (id === "auto-enhance" ? false : null) },
    ui: { commandPalette: reg, slashCommand: reg, blockContextMenu: reg },
    platform: { isMobile: () => false },
  };
  const storageMap = new Map();
  const storage = { getItem: (k) => storageMap.get(k) ?? null, setItem: (k, v) => { storageMap.set(k, String(v)); } };
  const lifecycle = createLifecycle();
  const button = doc.createElement("button");
  button.className = "bp3-button rm-xparser-default-diagram";
  button.closestMap['[id^="block-input-"]'] = { id: `block-input-w-body-outline-${uid}` };
  doc.app.append(button);
  try {
    await installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage });
    for (let i = 0; i < 2; i += 1) for (const cb of [...intervals.values()]) cb();
    await fn({ views, button });
  } finally {
    await lifecycle.dispose().catch(() => {});
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
}

test("PXD-22 feature.consider: {{diagram ((uid))}} on Roam's default button mounts a view", async () => {
  await withButtonEnv("{{diagram ((SRC000001))}}", ({ views }) => { assert.equal(views.length, 1); });
});

test("PXD-22 feature.consider: {{diagram foo}} and the colon ref form stay a plain button", async () => {
  await withButtonEnv("{{diagram foo}}", ({ views }) => { assert.equal(views.length, 0); });
  await withButtonEnv("{{[[diagram]]: ((SRC000001))}}", ({ views }) => { assert.equal(views.length, 0); });
});
