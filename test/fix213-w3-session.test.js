// 2.13.0 review fixes: A5 why with notes, B3 highlight watches, B4 one regions container, B7 props reads, C5 and D1 clones.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard } from "../src/model/board.js";
import { imageRegionString } from "../src/model/image-region.js";
import { parseRegion } from "../src/model/regions.js";
import "../src/session-clip.js";
import "../src/views.js";

afterEach(() => resetSessions());

const card = (uid, string, x, y, extra = {}, children = []) => ({
  uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } }, children,
});
const edgeBlock = (uid, from, to, string, children = []) => ({ uid, string, props: { plexus: { type: "edge", from, to } }, children });
const edgesBox = (uid, children) => ({ uid, string: "Connections", props: { plexus: { type: "edges" } }, open: false, children });

function setup(children, { blockString, prepare, session: sessionOpts = {} } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  if (blockString) {
    const read = host.blockString.bind(host);
    host.blockString = (id) => (id in blockString ? blockString[id] : read(id));
  }
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  prepare?.(host, fake);
  const session = acquireSession("b1", { host, linkDelay: 0, raf: (fn) => fn(), settings: { "graph-links": "off" }, ...sessionOpts });
  fake.clearLog();
  return { fake, host, session };
}

test("A5 clearing a why that has notes under it leaves the block and toasts", async () => {
  const { fake, session } = setup([
    card("a", "[[A]]", 0, 0),
    card("b", "[[B]]", 400, 0),
    edgesBox("box", [edgeBlock("e1", "a", "b", "[[A]] → [[B]]", [
      { uid: "why1", string: "because", children: [{ uid: "note1", string: "my own note" }] },
    ])]),
  ]);
  const toasts = [];
  session.on?.("toast", (t) => toasts.push(t.message));
  assert.equal(session.board.edges.get("e1").whyKids, 1);
  await session.commitWhy("e1", { label: "", why: "" });
  assert.equal(fake.has("why1"), true);
  assert.equal(fake.has("note1"), true);
  assert.equal(fake.writesLog().some((e) => e[0] === "delete"), false);
  assert.deepEqual(toasts, ["This why has notes under it. Edit it in the outline."]);
});

test("A5 a why without children is still deleted", async () => {
  const { fake, session } = setup([
    card("a", "[[A]]", 0, 0),
    card("b", "[[B]]", 400, 0),
    edgesBox("box", [edgeBlock("e1", "a", "b", "[[A]] → [[B]]", [{ uid: "why1", string: "because" }])]),
  ]);
  await session.commitWhy("e1", { label: "", why: "" });
  assert.equal(fake.has("why1"), false);
});

const HL_PROPS = { "pdf-highlight": { type: "text", content: { text: "x" }, position: { boundingRect: { pageNumber: 1 } } } };
const hlId = (i) => `hl${String(i).padStart(5, "0")}`;

function highlightSetup(count, raf = (fn) => fn()) {
  const watches = [];
  const calls = { props: [], pullBoard: 0 };
  const strings = new Map();
  const kids = [];
  for (let i = 0; i < count; i++) {
    kids.push(card(`c${i}`, `((${hlId(i)}))`, i * 10, 0));
    strings.set(hlId(i), "text #h/yellow");
  }
  const ctx = setup(kids, {
    blockString: Object.fromEntries(strings),
    session: { raf },
    prepare(host) {
      host.blockProps = (id) => { calls.props.push(id); return { props: HL_PROPS, string: strings.get(id), pageTitle: "p.pdf" }; };
      host.watchBlock = (id, cb) => { const rec = { id, cb, off: false }; watches.push(rec); return () => { rec.off = true; }; };
      const pull = host.pullBoard.bind(host);
      host.pullBoard = (id) => { calls.pullBoard++; return pull(id); };
    },
  });
  return { ...ctx, watches, calls };
}

test("B3 many highlight watches firing in one turn cost one board pull", () => {
  const queued = [];
  const { watches, calls } = highlightSetup(3, (fn) => queued.push(fn));
  assert.equal(watches.length, 3);
  calls.pullBoard = 0;
  for (const w of watches) w.cb();
  assert.equal(calls.pullBoard, 0, "a fire alone pulls nothing");
  assert.equal(queued.length, 1, "one flush is scheduled");
  queued.shift()();
  assert.equal(calls.pullBoard, 1);
});

test("B3 at most 60 highlight targets are watched", () => {
  const { watches } = highlightSetup(70);
  assert.equal(watches.length, 60);
});

test("B7 a plain block ref costs no props read, a tagged one does, and a rebuild reuses the read", () => {
  const strings = { plain00001: "just a note", tagged0001: "text #h/green" };
  const calls = [];
  const { session } = setup([
    card("c1", "((plain00001))", 0, 0),
    card("c2", "((tagged0001))", 300, 0),
  ], {
    blockString: strings,
    prepare(host) {
      host.blockProps = (id) => { calls.push(id); return { props: HL_PROPS, string: strings[id], pageTitle: "p.pdf" }; };
    },
  });
  assert.deepEqual(calls, ["tagged0001"]);
  assert.equal(session.board.items.get("c1").kind, "block");
  assert.equal(session.board.items.get("c2").kind, "highlight");
  session.commitMove(["c1"], 10, 10);
  const before = calls.length;
  session.setColor(["c1"], "teal");
  assert.equal(calls.length, before, "later rebuilds do not read props again");
});

test("B7 a highlight whose tag was removed is still read because it was a highlight", () => {
  const strings = { hlblock001: "text #h/green" };
  const calls = [];
  const watches = [];
  const { session } = setup([card("c1", "((hlblock001))", 0, 0)], {
    blockString: strings,
    prepare(host) {
      host.blockProps = (id) => { calls.push(id); return { props: HL_PROPS, string: strings[id], pageTitle: "p.pdf" }; };
      host.watchBlock = (id, cb) => { watches.push(cb); return () => {}; };
    },
  });
  assert.equal(session.board.items.get("c1").kind, "highlight");
  strings.hlblock001 = "text";
  watches[0]();
  assert.equal(session.board.items.get("c1").kind, "highlight");
  assert.equal(session.board.items.get("c1").highlight.color, "gray");
});

test("B4 a second region on the same highlight reuses the regions container", async () => {
  const { fake, session } = (() => {
    const fake = createFakeRoam();
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    fake.seedPage({ uid: "pg1", title: "Paper.pdf", children: [{ uid: "hlA", string: "area #h/yellow" }] });
    fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [card("c1", "((hlA))", 0, 0)] });
    return { fake, session: acquireSession("b1", { host, linkDelay: 0 }) };
  })();
  const frac = { rx: 0.1, ry: 0.1, rw: 0.2, rh: 0.2 };
  await session.addHighlightRegion("hlA", frac, "one", "regA00001");
  await session.addHighlightRegion("hlA", frac, "two", "regB00001");
  const boxes = fake.children("hlA");
  assert.equal(boxes.length, 1);
  assert.deepEqual(fake.children(boxes[0]), ["regA00001", "regB00001"]);
});

test("C5 a cloned connection between drawing-ref and block cards names the targets, not the card uids", async () => {
  const { fake, session } = setup([
    card("d1", "((draw00001))", 0, 0),
    card("k1", "((blk000001))", 400, 0),
    edgesBox("box", [edgeBlock("e1", "d1", "k1", "((draw00001)) → ((blk000001))")]),
  ], { blockString: { draw00001: "{{[[excalidraw]]}}", blk000001: "plain" } });
  assert.equal(session.board.items.get("d1").kind, "drawing-ref");
  const made = await session.duplicateItems(["d1", "k1"]);
  assert.equal(made.length, 2);
  const clones = fake.children("box").filter((u) => u !== "e1");
  assert.equal(clones.length, 1);
  assert.equal(fake.block(clones[0]).string, "((draw00001)) → ((blk000001))");
});

test("D1 duplicating an image card clones its regions and points d= at the copy", async () => {
  const frac = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };
  const { fake, session } = setup([
    card("img1", "![](https://example.test/a.png)", 0, 0, {}, [
      { uid: "rbox", string: "{{[[plexus-regions]]}}", props: { plexus: { type: "regions" } }, open: false, children: [
        { uid: "r1", string: imageRegionString("img1", frac, "left") },
      ] },
    ]),
  ]);
  assert.equal(session.board.items.get("img1").kind, "image");
  const [copy] = await session.duplicateItems(["img1"]);
  assert.notEqual(copy, "img1");
  const [box] = fake.children(copy);
  assert.ok(box, "the copy has a regions container");
  assert.equal(fake.block(box).string, "{{[[plexus-regions]]}}");
  assert.equal(fake.props(box).plexus.type, "regions");
  const [region] = fake.children(box);
  const parsed = parseRegion(fake.block(region).string);
  assert.equal(parsed.drawingUid, copy);
  assert.deepEqual(parsed.f, [0.25, 0.3, 0.2, 0.25]);
  assert.equal(parsed.caption, "left");
  assert.equal(fake.block("r1").string, imageRegionString("img1", frac, "left"), "the original region is untouched");
});
