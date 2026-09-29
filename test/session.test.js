import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
afterEach(() => resetSessions());

function seed(fake, extra = {}) {
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 }, plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 400, y: 0, w: 280, h: 160 } } },
      { uid: "c4", string: "a note", props: { plexus: { x: 800, y: 0 } } },
      {
        uid: "s1",
        string: "Group",
        props: { plexus: { type: "section", x: 0, y: 300, w: 500, h: 300 } },
        children: [{ uid: "c3", string: "[[C]]", props: { plexus: { x: 20, y: 60, w: 280, h: 160 } } }],
      },
    ],
    ...extra,
  });
}

function setup(opts = {}, { seedFn = seed } = {}) {
  const fake = createFakeRoam(opts);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedFn(fake);
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

const kinds = (fake, k) => fake.writesLog().filter((e) => e[0] === k);

test("acquire twice returns one session and one watch; release twice removes it; acquire writes nothing", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seed(fake);
  const a = acquireSession("b1", { host });
  const b = acquireSession("b1", { host });
  assert.equal(a, b);
  assert.equal(host.stats.watches, 1);
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
  a.release();
  assert.equal(host.stats.watches, 1);
  a.release();
  a.release();
  assert.equal(host.stats.watches, 0);
  assert.equal(fake.watchCount(), 0);
});

test("session builds the board from the pull", () => {
  const { session } = setup();
  assert.equal(session.board.items.size, 5);
  assert.equal(session.board.enhanced, true);
  assert.equal(session.board.items.get("c3").parentUid, "s1");
  assert.ok(session.rects.get("c3"));
});

test("commitMove of one card is a single props write and the model updates optimistically", async () => {
  const { fake, session } = setup();
  const events = [];
  session.on("change", (e) => events.push(e));
  const p = session.commitMove(["c1"], 30, 40);
  assert.equal(session.board.items.get("c1").x, 30);
  assert.equal(session.board.items.get("c1").y, 40);
  assert.equal(events.length, 1);
  assert.ok(events[0].dirty.has("c1"));
  assert.equal(fake.writesLog().length, 0);
  await p;
  assert.equal(fake.writesLog().length, 1);
  assert.equal(kinds(fake, "update").length, 1);
  assert.deepEqual(fake.props("c1"), { plexus: { x: 30, y: 40, w: 280, h: 160 } });
});

test("commitMove preserves other props keys on the card", async () => {
  const { fake, session } = setup();
  await session.commitMove(["c1"], 5, 0);
  fake.clearLog();
  fake.seedBoard({ uid: "zz", props: { "rf-diagram": { z: 1 } } });
  assert.equal(fake.props("b1")["rf-diagram"].keep, 1);
});

test("commitMove into a section: one move + one props write with relative coords", async () => {
  const { fake, session } = setup();
  await session.commitMove(["c2"], -300, 300);
  const log = fake.writesLog();
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], ["move", "c2", "s1", "last"]);
  assert.equal(log[1][0], "update");
  assert.deepEqual(fake.props("c2").plexus, { x: 100, y: 0, w: 280, h: 160 });
  assert.equal(session.board.items.get("c2").parentUid, "s1");
});

test("moving a section is one write and members follow", async () => {
  const { fake, session } = setup();
  await session.commitMove(["s1", "c3"], 10, 10);
  assert.equal(fake.writesLog().length, 1);
  assert.equal(fake.props("s1").plexus.x, 10);
  assert.equal(fake.props("c3").plexus.x, 20);
});

test("echo safety: quick double commitMove never reports the stale x", async () => {
  const { session } = setup({ echoDelay: 30, echoMode: "snapshot" });
  await session.commitMove(["c1"], 10, 0);
  const seen = [];
  session.on("change", () => seen.push(session.board.items.get("c1").x));
  const p = session.commitMove(["c1"], 10, 0);
  await p;
  await sleep(200);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((x) => x === 20), `saw ${seen}`);
  assert.equal(session.board.items.get("c1").x, 20);
});

test("echo safety: overlapping in-flight commits with write delay", async () => {
  const { session } = setup({ echoDelay: 30, writeDelay: 15, echoMode: "snapshot" });
  const seen = [];
  const a = session.commitMove(["c1"], 10, 0);
  const b = session.commitMove(["c1"], 10, 0);
  session.on("change", () => seen.push(session.board.items.get("c1").x));
  await Promise.all([a, b]);
  await sleep(200);
  assert.ok(seen.every((x) => x === 20), `saw ${seen}`);
});

test("external change is accepted after the grace period", async () => {
  const { fake, session } = setup({ echoDelay: 5 });
  await session.commitMove(["c1"], 10, 0);
  await sleep(50);
  await fake.api.data.block.update({ block: { uid: "c1", props: { plexus: { x: 999, y: 0, w: 280, h: 160 } } } });
  await sleep(50);
  assert.equal(session.board.items.get("c1").x, 10);
});

test("external change on another block is accepted immediately", async () => {
  const { fake, session } = setup({ echoDelay: 5 });
  await fake.api.data.block.update({ block: { uid: "c2", props: { plexus: { x: 555, y: 0 } } } });
  await sleep(50);
  assert.equal(session.board.items.get("c2").x, 555);
});

test("createSection via rect: one create, contained members move in (one move + props each)", async () => {
  const { fake, session } = setup();
  const uid = await session.createSection({ rect: { x: -20, y: -20, w: 340, h: 200 }, title: "Wrap" });
  assert.equal(kinds(fake, "create").length, 1);
  assert.equal(kinds(fake, "move").length, 1);
  assert.equal(kinds(fake, "update").length, 1);
  assert.deepEqual(kinds(fake, "move")[0], ["move", "c1", uid, "last"]);
  assert.deepEqual(fake.props(uid).plexus, { type: "section", x: -20, y: -20, w: 340, h: 200 });
  assert.equal(fake.block(uid).string, "Wrap");
  assert.deepEqual(fake.props("c1").plexus, { x: 20, y: 20, w: 280, h: 160 });
  assert.equal(session.board.items.get("c1").parentUid, uid);
  assert.equal(session.board.items.get("c2").parentUid, "b1");
});

test("createSection concurrent with another mutation yields one section", async () => {
  const { fake, session } = setup();
  const [uid] = await Promise.all([
    session.createSection({ rect: { x: -20, y: -20, w: 340, h: 200 } }),
    session.commitMove(["c2"], 10, 0),
  ]);
  const sections = [...session.board.items.values()].filter((i) => i.type === "section" && i.uid !== "s1");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].uid, uid);
  assert.equal(kinds(fake, "create").length, 1);
});

test("wrapInSection pads bounds by 32", async () => {
  const { fake, session } = setup();
  const uid = await session.wrapInSection(["c1"]);
  assert.deepEqual(fake.props(uid).plexus, { type: "section", x: -32, y: -32, w: 344, h: 224 });
  assert.equal(fake.block("c1").parent, uid);
});

test("createCard lands in the container under the point, position relative", async () => {
  const { fake, session } = setup();
  const uid = await session.createCard({ x: 40, y: 340, string: "[[New]]" });
  assert.equal(fake.block(uid).parent, "s1");
  assert.deepEqual(fake.props(uid).plexus, { x: 40, y: 40 });
  assert.equal(kinds(fake, "create").length, 1);
});

test("new root cards are inserted before the connections container", async () => {
  const { fake, session } = setup();
  const e = await session.addEdge({ from: "c1", to: "c2" });
  assert.ok(e);
  const containerUid = session.board.containerUid;
  const uid = await session.createText({ x: 1000, y: 1000, string: "hi" });
  const kids = fake.children("b1");
  assert.equal(kids.at(-1), containerUid);
  assert.equal(kids.at(-2), uid);
  assert.equal(fake.props(uid).plexus.type, "text");
});

test("deleteItems on a section frame-only keeps members, moved up with converted coords", async () => {
  const { fake, session } = setup();
  await session.deleteItems(["s1"]);
  assert.equal(fake.has("s1"), false);
  assert.equal(fake.block("c3").parent, "b1");
  assert.deepEqual(fake.props("c3").plexus, { x: 20, y: 360, w: 280, h: 160 });
  const log = fake.writesLog().map((e) => e[0]);
  assert.deepEqual(log, ["move", "update", "delete"]);
});

test("deleteItems withContents deletes the subtree", async () => {
  const { fake, session } = setup();
  await session.deleteItems(["s1"], { withContents: true });
  assert.equal(fake.has("s1"), false);
  assert.equal(fake.has("c3"), false);
  assert.deepEqual(kinds(fake, "delete").map((e) => e[1]), ["s1"]);
});

test("deleting items deletes edges touching them", async () => {
  const { fake, session } = setup();
  const e1 = await session.addEdge({ from: "c1", to: "c3" });
  const e2 = await session.addEdge({ from: "c1", to: "c2" });
  await session.deleteItems(["c3"]);
  assert.equal(fake.has(e1), false);
  assert.equal(fake.has(e2), true);
  const e3 = await session.addEdge({ from: "c1", to: "c3x" });
  assert.equal(e3, null);
});

test("deleteItems withContents also removes edges touching descendants", async () => {
  const { fake, session } = setup();
  const e1 = await session.addEdge({ from: "c1", to: "c3" });
  await session.deleteItems(["s1"], { withContents: true });
  assert.equal(fake.has(e1), false);
  assert.equal(session.board.edges.size, 0);
});

test("addEdge creates the container lazily and writes the semantic string", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c4" });
  const creates = kinds(fake, "create");
  assert.equal(creates.length, 2);
  const container = fake.block(creates[0][1]);
  assert.equal(container.open, false);
  assert.equal(container.string, "Connections");
  assert.deepEqual(container.props, { plexus: { type: "edges" } });
  assert.equal(fake.children("b1").at(-1), container.uid);
  const edge = fake.block(uid);
  assert.equal(edge.string, "[[A]] → ((c4))");
  assert.deepEqual(edge.props.plexus, { type: "edge", from: "c1", to: "c4" });
  assert.equal(edge.parent, container.uid);
  assert.equal(session.board.edges.get(uid).label, "");
});

test("addEdge duplicate same-direction pair returns the existing edge with no writes", async () => {
  const { fake, session } = setup();
  const a = await session.addEdge({ from: "c1", to: "c2", label: "causes" });
  fake.clearLog();
  const b = await session.addEdge({ from: "c1", to: "c2" });
  assert.equal(a, b);
  assert.equal(fake.writesLog().length, 0);
  const reverse = await session.addEdge({ from: "c2", to: "c1" });
  assert.notEqual(reverse, a);
});

test("updateEdge label rewrites the string; other patches leave it alone", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2" });
  fake.clearLog();
  await session.updateEdge(uid, { label: "causes" });
  assert.equal(fake.block(uid).string, "[[A]] → causes → [[B]]");
  assert.equal(session.board.edges.get(uid).label, "causes");
  await session.updateEdge(uid, { dir: "two" });
  assert.equal(fake.block(uid).string, "[[A]] ↔ causes ↔ [[B]]");
  fake.clearLog();
  await session.updateEdge(uid, { route: "elbow", weight: 2 });
  assert.equal(kinds(fake, "update").length, 1);
  assert.equal(fake.block(uid).props.plexus.route, "elbow");
  assert.equal(fake.block(uid).string, "[[A]] ↔ causes ↔ [[B]]");
});

test("flipEdge swaps endpoints and the string", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2", label: "causes" });
  await session.flipEdge(uid);
  const b = fake.block(uid);
  assert.equal(b.string, "[[B]] → causes → [[A]]");
  assert.equal(b.props.plexus.from, "c2");
  assert.equal(b.props.plexus.to, "c1");
  assert.equal(session.board.edges.get(uid).from, "c2");
});

test("deleteEdges and setColor on items and edges", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2" });
  await session.setColor(["c1", uid], "teal");
  assert.equal(fake.props("c1").plexus.color, "teal");
  assert.equal(fake.props(uid).plexus.color, "teal");
  await session.setColor(["c1"], null);
  assert.equal(fake.props("c1").plexus.color, undefined);
  await session.deleteEdges([uid]);
  assert.equal(fake.has(uid), false);
});

test("setString, setCollapsed, setFontSize, growToFit", async () => {
  const { fake, session } = setup();
  await session.setString("c4", "new text");
  assert.equal(fake.block("c4").string, "new text");
  await session.setCollapsed("c1", true);
  assert.equal(fake.props("c1").plexus.collapsed, true);
  await session.growToFit("c1", 5000);
  assert.equal(fake.props("c1").plexus.h, 900);
  fake.clearLog();
  await session.growToFit("c1", 100);
  assert.equal(fake.writesLog().length, 0);
});

test("writeToGraph: page source with bare attribute block appends a child", async () => {
  const { fake, session } = setup();
  fake.seedPage({ title: "A", uid: "pageA", children: [{ uid: "attr", string: "Causes::" }] });
  const uid = await session.addEdge({ from: "c1", to: "c2", label: "Causes" });
  fake.clearLog();
  const res = await session.writeToGraph(uid);
  assert.deepEqual(res, { ok: true, reason: "appended" });
  const kid = fake.block(fake.children("attr")[0]);
  assert.equal(kid.string, "[[B]]");
});

test("writeToGraph: page source without attribute creates a top-level block", async () => {
  const { fake, session } = setup();
  fake.seedPage({ title: "A", uid: "pageA", children: [{ uid: "other", string: "notes" }] });
  const uid = await session.addEdge({ from: "c1", to: "c2", label: "Causes" });
  const res = await session.writeToGraph(uid);
  assert.deepEqual(res, { ok: true, reason: "created" });
  const last = fake.block(fake.children("pageA").at(-1));
  assert.equal(last.string, "Causes:: [[B]]");
});

test("writeToGraph: block source creates a child under the block", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c4", to: "c2", label: "supports" });
  const res = await session.writeToGraph(uid);
  assert.equal(res.ok, true);
  const kid = fake.block(fake.children("c4")[0]);
  assert.equal(kid.string, "supports:: [[B]]");
});

test("writeToGraph refuses BT_attr, '::' and empty labels and writes nothing", async () => {
  const { fake, session } = setup();
  fake.seedPage({ title: "A", uid: "pageA" });
  const a = await session.addEdge({ from: "c1", to: "c2", label: "BT_attrDue" });
  const b = await session.addEdge({ from: "c2", to: "c1", label: "a::b" });
  const c = await session.addEdge({ from: "c1", to: "c4" });
  fake.clearLog();
  assert.equal((await session.writeToGraph(a)).ok, false);
  assert.equal((await session.writeToGraph(a)).reason, "reserved-label");
  assert.equal((await session.writeToGraph(b)).reason, "invalid-label");
  assert.equal((await session.writeToGraph(c)).reason, "empty-label");
  assert.equal(fake.writesLog().length, 0);
});

test("pinLink creates an edge labeled with the first relation", async () => {
  const { fake, session } = setup();
  const uid = await session.pinLink({ from: "c1", to: "c2", labels: ["Causes", "mentions"], kind: "attr" });
  assert.equal(session.board.edges.get(uid).label, "Causes");
  const m = await session.pinLink({ from: "c2", to: "c1", labels: ["mentions"], kind: "ref" });
  assert.equal(session.board.edges.get(m).label, "");
  assert.ok(fake.has(uid));
});

test("write failure emits a toast and repulls the board", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  fake.failNext = 1;
  await session.commitMove(["c1"], 50, 0);
  assert.equal(toasts.length, 1);
  assert.equal(session.board.items.get("c1").x, 0);
});

test("busy transitions are emitted around queued writes", async () => {
  const { session } = setup();
  const seen = [];
  session.on("busy", (b) => seen.push(b));
  const p = session.commitMove(["c1"], 5, 0);
  assert.equal(session.busy, true);
  await p;
  assert.equal(session.busy, false);
  assert.deepEqual(seen, [true, false]);
});

test("undo and redo call the host and repull", async () => {
  const { fake, session } = setup();
  await session.undo();
  await session.redo();
  assert.deepEqual(fake.calls.map((c) => c[0]), ["undo", "redo"]);
});

test("commitRects resizes items and section adoption moves members", async () => {
  const { fake, session } = setup();
  await session.commitRects([{ uid: "c1", x: 0, y: 0, w: 300, h: 200 }]);
  assert.deepEqual(fake.props("c1").plexus, { x: 0, y: 0, w: 300, h: 200 });
  fake.clearLog();
  await session.commitRects([{ uid: "s1", x: 0, y: 0, w: 500, h: 700 }]);
  assert.equal(fake.block("c1").parent, "s1");
});

// ---- enhance ----

function seedV06(fake) {
  fake.seedPage({
    title: "plexus-diagram/metadata",
    children: [{ string: "enhanced::", children: [{ uid: "entry1", string: "b1", children: [
      { string: "node c1", children: [{ string: "pos:: 10,10" }, { string: "size:: 280,160" }] },
      { string: "node c2", children: [{ string: "pos:: 700,20" }] },
      { string: "edge c1->c2", children: [{ string: "label:: causes" }] },
      { string: "section s-old", children: [{ string: "pos:: 0,0" }, { string: "size:: 400,300" }, { string: "title:: Group" }] },
      { string: "viewport:: 1,2,0.5" },
    ] }] }],
  });
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 } },
    children: [{ uid: "c1", string: "[[A]]" }, { uid: "c2", string: "[[B]]" }],
  });
}

test("enhance imports a v06 board and merges board props", async () => {
  const { fake, session } = setup({}, { seedFn: seedV06 });
  assert.equal(session.board.enhanced, false);
  const res = await session.enhance();
  assert.equal(res.enhanced, true);
  assert.equal(res.kind, "v06");
  assert.deepEqual(fake.props("b1"), { "rf-diagram": { keep: 1 }, plexus: { v: 2 } });
  assert.equal(session.board.enhanced, true);
  assert.equal(session.board.edges.size, 1);
  const sections = [...session.board.items.values()].filter((i) => i.type === "section");
  assert.equal(sections.length, 1);
  assert.equal(session.board.items.get("c1").parentUid, sections[0].uid);
  assert.deepEqual(host_vp(session), { x: 1, y: 2, zoom: 0.5 });
});

function host_vp(session) { return session.host.viewports.get("b1"); }

test("enhance scales a native board", async () => {
  const seedNative = (fake) => fake.seedBoard({
    uid: "b1",
    children: [{ uid: "a", string: "[[A]]" }, { uid: "b", string: "[[B]]" }],
    diagram: { nodes: [
      { id: 1, blockUid: "a", data: { position: { x: 0, y: 0 }, width: 120, height: 60 } },
      { id: 2, blockUid: "b", data: { position: { x: 100, y: 50 }, width: 120, height: 60 } },
    ], edges: [{ source: 1, target: 2, data: {} }] },
  });
  const { fake, session } = setup({}, { seedFn: seedNative });
  const res = await session.enhance();
  assert.equal(res.kind, "native");
  assert.equal(fake.props("b").plexus.x, 200);
  assert.equal(fake.props("b").plexus.y, 100);
  assert.equal(session.board.edges.size, 1);
  assert.equal(session.board.enhanced, true);
});

test("enhance on an already-enhanced board is a no-op with zero writes", async () => {
  const { fake, session } = setup();
  const res = await session.enhance();
  assert.equal(res.enhanced, false);
  assert.equal(fake.writesLog().length, 0);
});

test("restoreNative removes only plexus from board props", async () => {
  const { fake, session } = setup();
  await session.restoreNative();
  assert.deepEqual(fake.props("b1"), { "rf-diagram": { keep: 1 } });
  assert.equal(session.board.enhanced, false);
  assert.ok(fake.props("c1").plexus);
});

// ---- links ----

test("refreshLinks emits links with mode filter and coveredBy applied", async () => {
  const { fake, host, session } = setup();
  fake.seedPage({ title: "A", uid: "pageA" });
  fake.seedPage({ title: "B", uid: "pageB" });
  const eidA = host.resolveEid({ title: "A" });
  const eidB = host.resolveEid({ title: "B" });
  fake.setQ(() => [
    [eidA, eidB, "src1", "Causes:: [[B]]"],
    [eidB, eidA, "src2", "see [[A]]"],
  ]);
  session.setLinkMode("attributes");
  const events = [];
  session.on("links", (e) => events.push(e));
  await session.refreshLinks();
  assert.equal(session.links.length, 1);
  assert.equal(session.links[0].key, "c1->c2");
  assert.deepEqual(session.links[0].labels, ["Causes"]);
  assert.equal(events.length, 1);
  session.setLinkMode("all");
  assert.equal(session.links.length, 2);
  session.setLinkMode("off");
  assert.equal(session.links.length, 0);
  session.setLinkMode("all");
  await session.addEdge({ from: "c1", to: "c2" });
  assert.equal(session.links.length, 0);
  assert.equal(session.coveredEdges.size, 1);
});

test("links resolve parent strings for sources under a bare attribute", async () => {
  const { fake, host, session } = setup();
  fake.seedPage({ title: "A", uid: "pageA", children: [{ uid: "attr", string: "Causes::", children: [{ uid: "src", string: "[[B]]" }] }] });
  fake.seedPage({ title: "B", uid: "pageB" });
  const eidA = host.resolveEid({ title: "A" });
  const eidB = host.resolveEid({ title: "B" });
  fake.setQ(() => [[eidA, eidB, "src", "[[B]]"]]);
  await session.refreshLinks();
  assert.deepEqual(session.links[0].labels, ["Causes"]);
});
