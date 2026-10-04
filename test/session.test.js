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

function setup(opts = {}, { seedFn = seed, settings = null } = {}) {
  const fake = createFakeRoam(opts);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedFn(fake);
  const session = acquireSession("b1", { host, settings, linkDelay: 0 });
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
  await session.commitMove(["c2"], -280, 340);
  const log = fake.writesLog();
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], ["move", "c2", "s1", "last"]);
  assert.equal(log[1][0], "update");
  assert.deepEqual(fake.props("c2").plexus, { x: 120, y: 40, w: 280, h: 160 });
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

test("TP-8: a lane adopts a card inside it and keeps the lane look", async () => {
  const { fake, session } = setup();
  const uid = await session.createSection({
    rect: { x: -20, y: -20, w: 400, h: 220 },
    title: "Warehouse",
    look: "lane",
    axis: "vertical",
  });
  assert.deepEqual(fake.props(uid).plexus, { type: "section", x: -20, y: -20, w: 400, h: 220, look: "lane", axis: "vertical" });
  assert.equal(session.board.items.get(uid).look, "lane");
  assert.equal(session.board.items.get(uid).axis, "vertical");
  assert.equal(session.board.items.get("c1").parentUid, uid);
  assert.equal(session.board.items.get("c2").parentUid, "b1");
  assert.deepEqual(fake.props("c1").plexus, { x: 20, y: 20, w: 280, h: 160 });
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

test("RG-9: groupUnder creates a section titled with the parent and reuses it", async () => {
  const { session } = setup();
  const a = await session.createCard({ x: 40, y: 40, string: "[[Project/Sub]]" });
  const b = await session.createCard({ x: 400, y: 40, string: "[[Project/Other]]" });
  const note = await session.createCard({ x: 1400, y: 40, string: "not a page" });
  const section = await session.groupUnder([a, b, note], "Project");
  assert.equal(session.board.items.get(section).type, "section");
  assert.equal(session.board.items.get(section).title, "Project");
  assert.equal(session.board.items.get(a).parentUid, section);
  assert.equal(session.board.items.get(b).parentUid, section);
  assert.equal(session.board.items.get(note).parentUid, "b1");
  const third = await session.createCard({ x: 800, y: 40, string: "[[Project/Third]]" });
  const reused = await session.groupUnder([third], "Project");
  assert.equal(reused, section);
  assert.equal(session.board.items.get(third).parentUid, section);
  const named = [...session.board.items.values()].filter((item) => item.type === "section" && item.title === "Project");
  assert.equal(named.length, 1);
  assert.equal(await session.groupUnder([third], "Project"), section);
});

test("createCard stores look block on a note and omits it on a page ref; setLook round-trips", async () => {
  const { fake, session } = setup();
  const note = await session.createCard({ x: 1000, y: 1000, string: "alpha" });
  assert.equal(fake.props(note).plexus.look, "block");
  const page = await session.createCard({ x: 1000, y: 1200, string: "[[Page]]" });
  assert.equal(fake.props(page).plexus.look, undefined);
  await session.setLook(note, "card");
  assert.equal(fake.props(note).plexus.look, "card");
  assert.equal(session.board.items.get(note).look, "card");
  await session.setLook(note, "block");
  assert.equal(fake.props(note).plexus.look, "block");
  await session.setLook(note, "nope");
  assert.equal(fake.props(note).plexus.look, "block");
});

test("setBlockOpen writes Roam open on the card and leaves plexus props alone", async () => {
  const { fake, session } = setup();
  await fake.api.data.block.create({
    location: { "parent-uid": "c4", order: "last" },
    block: { uid: "kidOPEN1", string: "child", open: false },
  });
  await sleep(40);
  const childOpen = () => fake.block("kidOPEN1").open;
  assert.equal(childOpen(), false);
  assert.equal(session.board.items.get("c4").open, true);
  const before = fake.block("c4").open;
  await session.setBlockOpen("c4", false);
  await sleep(30);
  assert.equal(fake.block("c4").open, false);
  assert.equal(session.board.items.get("c4").open, false);
  assert.equal(childOpen(), false);
  assert.equal(fake.props("c4").plexus.x, 800);
  await session.setBlockOpen("c4", true);
  await sleep(30);
  assert.equal(fake.block("c4").open, before);
  assert.equal(session.board.items.get("c4").open, true);
  assert.equal(childOpen(), false);
  const writes = fake.writesLog().filter((e) => e[0] === "update" && e[1] === "kidOPEN1");
  assert.equal(writes.length, 0);
  assert.equal(await session.setBlockOpen("s1", false), false);
  assert.notEqual(fake.block("s1").open, false);
});

test("default-card-look card writes look card on a new note", async () => {
  const { fake, session } = setup({}, { settings: { "default-card-look": "card" } });
  const note = await session.createCard({ x: 1000, y: 1000, string: "alpha" });
  assert.equal(fake.props(note).plexus.look, "card");
  assert.equal(session.board.items.get(note).look, "card");
});

test("createCard lands in the container under the point, position relative", async () => {
  const { fake, session } = setup();
  const uid = await session.createCard({ x: 40, y: 340, string: "[[New]]" });
  assert.equal(fake.block(uid).parent, "s1");
  assert.deepEqual(fake.props(uid).plexus, { x: 40, y: 40 });
  assert.equal(kinds(fake, "create").length, 1);
});

test("createCard takes a palette color and a block/card look, and ignores anything else", async () => {
  const { fake, session } = setup();
  const styled = await session.createCard({ x: 10, y: 20, color: "blue", look: "card" });
  assert.equal(fake.props(styled).plexus.color, "blue");
  assert.equal(fake.props(styled).plexus.look, "card");
  const plain = await session.createCard({ x: 400, y: 20, color: "nope", look: "sticky" });
  assert.equal(fake.props(plain).plexus.color, undefined);
  assert.notEqual(fake.props(plain).plexus.look, "sticky");
});

test("createText sticky is 200 by 200 yellow and plain text keeps the text default", async () => {
  const { fake, session } = setup();
  const plain = await session.createText({ x: 1000, y: 1000, string: "hi" });
  assert.deepEqual(fake.props(plain).plexus, { type: "text", x: 1000, y: 1000 });
  assert.equal(session.board.items.get(plain).w, 240);
  assert.equal(session.board.items.get(plain).h, 48);
  assert.equal(session.board.items.get(plain).look, undefined);

  const shaped = await session.createText({ x: 10, y: 20, w: 160, h: 100, shape: "rectangle" });
  assert.equal(fake.props(shaped).plexus.shape, "rectangle");
  assert.equal(fake.props(shaped).plexus.w, 160);
  const rejected = await session.createText({ x: 10, y: 20, shape: "nope" });
  assert.equal(fake.props(rejected).plexus.shape, undefined);

  const sticky = await session.createText({ x: 1200, y: 40, string: "Note", look: "sticky" });
  assert.deepEqual(fake.props(sticky).plexus, {
    type: "text", x: 1200, y: 40, w: 200, h: 200, color: "yellow", look: "sticky",
  });
  assert.equal(session.board.items.get(sticky).look, "sticky");

  await session.setColor([sticky], "blue");
  assert.equal(fake.props(sticky).plexus.color, "blue");
  assert.equal(fake.props(sticky).plexus.look, "sticky");
  assert.equal(fake.props(sticky).plexus.w, 200);

  await session.setColor([sticky], "#ff66a1");
  assert.equal(fake.props(sticky).plexus.color, "#ff66a1");
  assert.equal(fake.props(sticky).plexus.look, "sticky");

  await session.commitRects([{ uid: sticky, x: 1200, y: 40, w: 260, h: 180 }]);
  const after = fake.props(sticky).plexus;
  assert.equal(after.w, 260);
  assert.equal(after.h, 180);
  assert.equal(after.look, "sticky");
  assert.equal(after.color, "#ff66a1");
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

test("PF-8: a failed write stays optimistic through 3 retries, then reverts", async () => {
  const { fake, session } = setup();
  const sync = [];
  const toasts = [];
  let during = null;
  session.on("sync", (state) => {
    sync.push(state);
    if (state === "retrying" && during == null) during = session.board.items.get("c1").x;
  });
  session.on("toast", (t) => toasts.push(t.message));
  const spy = console.error;
  console.error = () => {};
  fake.failNext = 4;
  try {
    await session.commitMove(["c1"], 50, 0);
  } finally {
    console.error = spy;
  }
  assert.equal(during, 50, "the card stays at the optimistic x while retrying");
  assert.equal(session.board.items.get("c1").x, 0, "the last failure reloads the graph");
  assert.equal(fake.props("c1").plexus.x, 0);
  assert.deepEqual(toasts, ["Couldn't save changes to Roam. Reloaded the board from the graph."]);
  assert.ok(sync.includes("writing"));
  assert.ok(sync.includes("retrying"));
  assert.equal(sync.filter((s) => s === "retrying").length, 1);
  assert.equal(sync.at(-1), "failed");
  assert.equal(fake.log.filter((row) => row[0] === "fail").length, 4);
});

test("PF-8: one failed attempt then a retry keeps the move", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const spy = console.error;
  console.error = () => {};
  fake.failNext = 1;
  try {
    await session.commitMove(["c1"], 50, 0);
  } finally {
    console.error = spy;
  }
  assert.equal(toasts.length, 0);
  assert.equal(session.board.items.get("c1").x, 50);
  assert.equal(fake.props("c1").plexus.x, 50);
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

test("enhance collapses an open board with children in the same run, after the import", async () => {
  const { fake, session } = setup({}, { seedFn: seedV06 });
  assert.notEqual(fake.block("b1").open, false);
  await session.enhance();
  assert.equal(fake.block("b1").open, false);
  const log = fake.writesLog();
  const marker = log.findIndex((e) => e[0] === "update" && e[1] === "b1");
  assert.ok(marker >= 0);
  assert.equal(log.filter((e) => e[1] === "b1").length, 2, "one props write and one open write on the board block");
});

// The fake's seedBoard has no open option; a seeded update collapses the board before the session pulls it.
const seedClosed = ({ v }) => (fake) => {
  fake.seedBoard({ uid: "b1", props: v ? { plexus: { v: 2 } } : undefined, children: [{ uid: "a", string: "[[A]]" }] });
  fake.api.data.block.update({ block: { uid: "b1", open: false } });
};

test("enhance collapses an empty open board; an already-collapsed one only gets the marker", async () => {
  const empty = setup({}, { seedFn: (fake) => fake.seedBoard({ uid: "b1", children: [] }) });
  await empty.session.enhance();
  assert.equal(empty.fake.block("b1").open, false);
  const closed = setup({}, { seedFn: seedClosed({ v: false }) });
  await closed.session.enhance();
  assert.equal(closed.fake.block("b1").open, false);
  assert.equal(closed.fake.writesLog().filter((e) => e[1] === "b1").length, 1, "only the marker write");
});

test("collapse-outline false: enhance leaves the board open and new boards are created without open", async () => {
  const off = { "collapse-outline": false };
  const a = setup({}, { seedFn: seedV06, settings: off });
  await a.session.enhance();
  assert.notEqual(a.fake.block("b1").open, false);
  assert.equal(a.fake.writesLog().filter((e) => e[1] === "b1").length, 1, "only the marker write");
  const b = setup({}, { seedFn: seedNested, settings: { get: (k) => off[k] } });
  const uid = await b.session.createBoard({ rect: { x: 1400, y: 1400, w: 320, h: 220 } });
  assert.notEqual(b.fake.block(uid).open, false);
});

test("restoreNative leaves the open state alone", async () => {
  const { fake, session } = setup();
  await session.restoreNative();
  assert.notEqual(fake.block("b1").open, false);
  const closed = setup({}, { seedFn: seedClosed({ v: true }) });
  await closed.session.restoreNative();
  assert.equal(closed.fake.block("b1").open, false);
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

// ---- nested boards ----------------------------------------------------------------------------

function seedNested(fake) {
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 100, y: 100, w: 200, h: 100 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 400, y: 200, w: 200, h: 100 } } },
      { uid: "c3", string: "[[C]]", props: { plexus: { x: 1000, y: 0, w: 200, h: 100 } } },
      {
        uid: "nbFull",
        string: "{{[[diagram]]:Full}}",
        props: { "rf-diagram": { keep: 1 }, plexus: { x: 0, y: 500, w: 320, h: 220, v: 2 } },
        children: [
          { uid: "k1", string: "kid", props: { plexus: { x: 10, y: 20, w: 200, h: 100 } } },
          { uid: "k2", string: "kid2", props: { plexus: { x: 300, y: 0, w: 100, h: 100 } } },
          { uid: "kec", string: "Connections", props: { plexus: { type: "edges" } }, children: [] },
        ],
      },
      { uid: "nbNative", string: "{{[[diagram]]}}", props: { plexus: { x: 900, y: 500, w: 320, h: 220 } } },
      { uid: "nbEmpty", string: "{{[[diagram]]:Empty}}", props: { plexus: { x: 600, y: 500, w: 320, h: 220, v: 2 } } },
      {
        uid: "sec1",
        string: "Frame",
        props: { plexus: { type: "section", x: 0, y: 900, w: 600, h: 400 } },
        children: [
          { uid: "nbIn", string: "{{[[diagram]]:Inside}}", props: { plexus: { x: 20, y: 60, w: 320, h: 220, v: 2 } } },
          { uid: "c5", string: "in frame", props: { plexus: { x: 400, y: 60, w: 100, h: 100 } } },
        ],
      },
      {
        uid: "ec",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        children: [
          { uid: "e12", string: "[[A]] → [[B]]", props: { plexus: { type: "edge", from: "c1", to: "c2" } } },
          { uid: "e13", string: "[[A]] → [[C]]", props: { plexus: { type: "edge", from: "c1", to: "c3", fromSide: "right", toSide: "left" } } },
          { uid: "e23", string: "[[B]] → [[C]]", props: { plexus: { type: "edge", from: "c2", to: "c3" } } },
          { uid: "e1f", string: "[[A]] → ((nbFull))", props: { plexus: { type: "edge", from: "c1", to: "nbFull" } } },
        ],
      },
    ],
  });
}

const nestedSetup = (opts) => setup(opts, { seedFn: seedNested });

test("createBoard is exactly one create carrying the string, layout with v:2 and open:false", async () => {
  const { fake, session } = nestedSetup();
  const uid = await session.createBoard({ rect: { x: 1400, y: 1400, w: 320, h: 220 } });
  const log = fake.writesLog();
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], ["create", uid]);
  const b = fake.block(uid);
  assert.equal(b.string, "{{[[diagram]]:Untitled board}}");
  assert.deepEqual(b.props.plexus, { x: 1400, y: 1400, w: 320, h: 220, v: 2 });
  assert.equal(b.open, false);
  assert.equal(b.parent, "b1");
  assert.equal(fake.children("b1").indexOf(uid) < fake.children("b1").indexOf("ec"), true, "Connections stays last");
  const item = session.board.items.get(uid);
  assert.equal(item.kind, "board");
  assert.equal(item.hasLayout, true);
});

test("wrapInBoard creates the board block with open:false in its create call", async () => {
  const { fake, session } = nestedSetup();
  const uid = await session.wrapInBoard(["nbFull"]);
  assert.equal(fake.block(uid).open, false);
});

test("createBoard inside a section creates a board relative to it, and clamps to the card minimum", async () => {
  const { fake, session } = nestedSetup();
  const uid = await session.createBoard({ rect: { x: 50, y: 1000, w: 10, h: 10 }, title: "Plan" });
  assert.equal(fake.block(uid).parent, "sec1");
  assert.equal(fake.block(uid).string, "{{[[diagram]]:Plan}}");
  assert.deepEqual(fake.props(uid).plexus, { x: 50, y: 100, w: 200, h: 80, v: 2 });
});

test("moving or resizing a board card keeps v:2 and unknown keys", async () => {
  const { fake, session } = nestedSetup();
  await session.commitMove(["nbFull"], 10, 20);
  assert.deepEqual(fake.props("nbFull").plexus, { x: 10, y: 520, w: 320, h: 220, v: 2 });
  assert.deepEqual(fake.props("nbFull")["rf-diagram"], { keep: 1 });
  await session.commitRects([{ uid: "nbFull", x: 10, y: 520, w: 400, h: 300 }]);
  assert.deepEqual(fake.props("nbFull").plexus, { x: 10, y: 520, w: 400, h: 300, v: 2 });
});

test("wrapInBoard rebases coordinates, moves internal edges into a new Connections block and retargets crossing edges", async () => {
  const { fake, session } = nestedSetup();
  const uid = await session.wrapInBoard(["c1", "c2"]);
  assert.ok(uid);
  const nb = fake.block(uid);
  assert.equal(nb.string, "{{[[diagram]]:Untitled board}}");
  assert.equal(nb.parent, "b1");
  assert.deepEqual(nb.props.plexus, { x: 100, y: 100, w: 480, h: 200, v: 2 });
  assert.equal(nb.open, false);
  assert.equal(fake.block("c1").parent, uid);
  assert.equal(fake.block("c2").parent, uid);
  assert.deepEqual(fake.props("c1").plexus, { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(fake.props("c2").plexus, { x: 300, y: 100, w: 200, h: 100 });
  const kids = fake.children(uid);
  const container = kids.at(-1);
  assert.deepEqual(fake.props(container).plexus, { type: "edges" });
  assert.equal(fake.block(container).open, false);
  assert.deepEqual(fake.children(container), ["e12"], "the edge between the moved cards follows them");
  // crossing edges now point at the board card
  assert.deepEqual(fake.props("e13").plexus, { type: "edge", from: uid, to: "c3", toSide: "left" });
  assert.equal(fake.block("e13").string, `((${uid})) → [[C]]`);
  // e13 and e23 both become uid -> c3: the second is a duplicate and is deleted
  assert.equal(fake.has("e23"), false);
  assert.deepEqual(fake.props("e1f").plexus, { type: "edge", from: uid, to: "nbFull" });
  assert.equal(session.board.items.get(uid).kind, "board");
  assert.equal(session.board.items.has("c1"), false, "moved cards are no longer items of the parent board");
  assert.equal(session.board.items.get(uid).content.length, 3, "the card holds both cards and the new Connections block");
});

test("wrapInBoard of a selection whose only edge is internal creates one Connections block and no retargets", async () => {
  const { fake, session } = nestedSetup();
  const uid = await session.wrapInBoard(["c1", "c2", "c3"]);
  const container = fake.children(uid).at(-1);
  assert.deepEqual(fake.children(container).sort(), ["e12", "e13", "e23"]);
  assert.equal(fake.props("e1f").plexus.from, uid, "an edge to a card outside is retargeted to the board");
});

test("moveIntoBoard puts items to the right of existing child content, rebased, in one move+props per item", async () => {
  const { fake, session } = nestedSetup();
  fake.clearLog();
  const res = await session.moveIntoBoard(["c1"], "nbFull");
  assert.equal(res.title, "Full");
  assert.equal(res.boardUid, "nbFull");
  assert.deepEqual(res.moved, ["c1"]);
  assert.equal(fake.block("c1").parent, "nbFull");
  // child bounds: x 10..400, y 0..120 -> place at x 448, y 0 (origin is the moved bounds' top-left)
  assert.deepEqual(fake.props("c1").plexus, { x: 448, y: 0, w: 200, h: 100 });
  const kids = fake.children("nbFull");
  assert.equal(kids.at(-1), "kec", "Connections stays last inside the child");
  assert.equal(kids.indexOf("c1"), 2);
  // e12 crosses (c1 moved, c2 not): retargeted to the board; e13 becomes nbFull->c3; e1f would be a self edge and is deleted
  assert.deepEqual(fake.props("e12").plexus, { type: "edge", from: "nbFull", to: "c2" });
  assert.equal(fake.has("e1f"), false, "an edge between the moved card and the board itself disappears");
  assert.deepEqual(fake.props("e13").plexus, { type: "edge", from: "nbFull", to: "c3", toSide: "left" });
  assert.equal(fake.block("e12").string, "((nbFull)) → [[B]]");
});

test("moveIntoBoard into an empty board places at 0,0 and moves internal edges into a fresh Connections block", async () => {
  const { fake, session } = nestedSetup();
  const res = await session.moveIntoBoard(["c1", "c2"], "nbEmpty");
  assert.ok(res);
  assert.deepEqual(fake.props("c1").plexus, { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(fake.props("c2").plexus, { x: 300, y: 100, w: 200, h: 100 });
  const container = fake.children("nbEmpty").at(-1);
  assert.deepEqual(fake.props(container).plexus, { type: "edges" });
  assert.deepEqual(fake.children(container), ["e12"]);
});

test("moveIntoBoard refuses a non-board target, the board itself and a section that contains it", async () => {
  const { fake, session } = nestedSetup();
  fake.clearLog();
  assert.equal(await session.moveIntoBoard(["c1"], "c2"), null);
  assert.equal(await session.moveIntoBoard(["nbFull"], "nbFull"), null);
  assert.equal(await session.moveIntoBoard(["sec1"], "nbIn"), null, "a section holding the target cannot move into it");
  assert.equal(fake.writesLog().length, 0);
  const res = await session.moveIntoBoard(["nbFull", "c1"], "nbFull");
  assert.deepEqual(res.moved, ["c1"], "the target itself is dropped from the selection");
});

test("moveIntoBoard undo restores parents, orders, props and edges in one transaction", async () => {
  const { fake, session } = nestedSetup();
  const before = {
    root: fake.children("b1"),
    ec: fake.children("ec"),
    c1: fake.props("c1"),
    c2: fake.props("c2"),
    e12: fake.props("e12"),
    e13: fake.props("e13"),
    s12: fake.block("e12").string,
    s13: fake.block("e13").string,
    e1f: fake.block("e1f"),
  };
  const res = await session.moveIntoBoard(["c1", "c2"], "nbEmpty");
  assert.notDeepEqual(fake.children("b1"), before.root);
  await res.undo();
  assert.deepEqual(fake.children("b1"), before.root);
  assert.deepEqual(fake.props("c1"), before.c1);
  assert.deepEqual(fake.props("c2"), before.c2);
  assert.equal(fake.block("c1").parent, "b1");
  assert.deepEqual(fake.children("ec"), before.ec);
  assert.deepEqual(fake.props("e12"), before.e12);
  assert.deepEqual(fake.props("e13"), before.e13);
  assert.equal(fake.block("e12").string, before.s12);
  assert.equal(fake.block("e13").string, before.s13);
  assert.equal(fake.has("e1f"), true);
  assert.deepEqual(fake.children("nbEmpty"), [], "the Connections block created for the move is removed again");
});

test("moveIntoBoard undo re-creates an edge that the move deleted", async () => {
  const { fake, session } = nestedSetup();
  const res = await session.moveIntoBoard(["c1"], "nbFull");
  assert.equal(fake.has("e1f"), false);
  await res.undo();
  assert.equal(fake.has("e1f"), true);
  assert.deepEqual(fake.props("e1f").plexus, { type: "edge", from: "c1", to: "nbFull" });
  assert.equal(fake.block("e1f").parent, "ec");
  assert.equal(fake.block("c1").parent, "b1");
});

test("renameBoard rewrites only the token; a non-board uid is ignored", async () => {
  const { fake, session } = nestedSetup();
  await session.setString("nbFull", "{{diagram:Full}} tail");
  fake.clearLog();
  await session.renameBoard("nbFull", "Roadmap");
  assert.equal(fake.block("nbFull").string, "{{diagram:Roadmap}} tail");
  assert.equal(fake.writesLog().length, 1);
  await session.renameBoard("nbFull", "Roadmap");
  assert.equal(fake.writesLog().length, 1, "same title writes nothing");
  await session.renameBoard("c1", "Nope");
  assert.equal(fake.block("c1").string, "[[A]]");
  await session.renameBoard("nbEmpty", "");
  assert.equal(fake.block("nbEmpty").string, "{{[[diagram]]:Untitled board}}");
});

test("restoreNative on a nested board keeps its layout and removes only the marker", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedNested(fake);
  const session = acquireSession("nbFull", { host, settings: null, linkDelay: 0 });
  await session.restoreNative();
  assert.deepEqual(fake.props("nbFull"), { "rf-diagram": { keep: 1 }, plexus: { x: 0, y: 500, w: 320, h: 220 } });
  const root = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  await root.restoreNative();
  assert.equal(fake.props("b1").plexus, undefined);
});

test("a non-enhanced native diagram card is neither a move target nor renameable", async () => {
  const { fake, session } = nestedSetup();
  assert.equal(session.board.items.get("nbNative").enhanced, false);
  assert.equal(session.board.items.get("nbFull").enhanced, true);
  fake.clearLog();
  assert.equal(await session.moveIntoBoard(["c1"], "nbNative"), null);
  await session.renameBoard("nbNative", "Foo");
  assert.equal(fake.block("nbNative").string, "{{[[diagram]]}}");
  assert.equal(fake.writesLog().length, 0);
});

test("session emits gone once when the board block disappears, and stops writing", async () => {
  const { session, host } = setup();
  const seen = [];
  session.on("gone", () => seen.push(1));
  await host.deleteBlock("b1");
  await sleep(30);
  assert.deepEqual(seen, [1]);
  assert.equal(session.gone, true);
  assert.equal(await session.commitMove?.("c1", { x: 5, y: 5 }), undefined);
});

test("a foreign edit that arrives while the queue is idle asks the host to drop its undo log; our own echo does not", async () => {
  const { fake, host, session } = setup({ echoDelay: 5 });
  let invalidated = 0;
  host.invalidateUndo = () => { invalidated += 1; };
  await session.commitMove(["c1"], 10, 0);
  await sleep(50);
  assert.equal(invalidated, 0, "the echo of our own write is already in the optimistic model");
  await fake.api.data.block.update({ block: { uid: "c2", props: { plexus: { x: 555, y: 0 } } } });
  await sleep(50);
  assert.ok(invalidated >= 1, "an edit made elsewhere in Roam is a foreign change");
});
