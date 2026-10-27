// PXD-11: attribute lanes through the session (bind, drop writes, marks, undo) and the lane menu.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-lanes.js";
import { buildMenu } from "../src/view/menu-model.js";
import { normalizeItemLayout, serializeItemLayout } from "../src/model/schema.js";

afterEach(() => resetSessions());

const card = (uid, string, x, y, children = [], extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 120, h: 60, ...extra } }, children });
const attr = (uid, string) => ({ uid, string });
const lane = (children, plexus = {}) => ({
  uid: "L",
  string: "Lane",
  props: { plexus: { type: "section", look: "lane", axis: "horizontal", x: 0, y: 0, w: 600, h: 300, ...plexus } },
  children,
});
const BOUND = { attr: "Priority", bands: ["High", "Low"] };

function setup(children, plexus = BOUND, { pages = [] } = {}) {
  const fake = createFakeRoam({ echoDelay: 0 });
  for (const page of pages) fake.seedPage(page);
  fake.seedBoard({ uid: "BRD", props: { plexus: { v: 2 } }, children: [lane(children, plexus)] });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const session = acquireSession("BRD", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}
const kids = () => [
  card("a", "Task A", 20, 40, [attr("a1", "Priority:: High")]),
  card("b", "Task B", 220, 40, [attr("b1", "Priority:: [[Low]]")]),
  card("c", "Task C", 420, 40),
  card("d", "Task D", 20, 140, [attr("d1", "Priority:: High"), attr("d2", "Priority:: Low")]),
];
const stringWrites = (fake) => fake.writesLog().filter((w) => w[0] === "update" && fake.block(w[1])?.string?.includes("::")).map((w) => w[1]);
const plexusOf = (fake, uid) => fake.props(uid)?.plexus;

test("PXD-11 schema: attr and bands persist on lane sections only", () => {
  const out = serializeItemLayout({ type: "section", look: "lane", axis: "vertical", attr: " Priority ", bands: ["High", 3, "", "Low"] });
  assert.deepEqual(out, { type: "section", look: "lane", axis: "vertical", attr: "Priority", bands: ["High", "Low"] });
  assert.deepEqual(serializeItemLayout({ type: "section", look: "calendar", attr: "Priority", bands: ["High"] }), { type: "section", look: "calendar" });
  assert.deepEqual(serializeItemLayout({ type: "card", attr: "Priority" }), {});
  const n = normalizeItemLayout({ type: "section", look: "lane", attr: "Priority", bands: ["High"] });
  assert.deepEqual([n.attr, n.bands], ["Priority", ["High"]]);
  assert.equal(normalizeItemLayout({ type: "section", look: "lane", bands: ["High"] }).bands, undefined, "bands without an attribute are dropped");
});

test("PXD-11 board: a bound lane carries laneAttr and laneBands, an unbound one does not", () => {
  const { session } = setup(kids());
  const item = session.board.items.get("L");
  assert.equal(item.laneAttr, "Priority");
  assert.deepEqual(item.laneBands, ["High", "Low"]);
  assert.deepEqual(item.laneView.map((b) => [b.label, b.n]), [["High", 2], ["Low", 1], ["none", 1]]);
  assert.equal(session.board.items.get("a").laneMark.label, "High");
  assert.equal(session.board.items.get("c").laneMark.none, true);
  assert.equal(session.board.items.get("d").laneMark.two, true);
  const plain = setup(kids(), {}).session.board.items.get("L");
  assert.equal(plain.laneAttr, undefined);
  assert.equal(plain.laneView, undefined);
});

test("PXD-11 bindLane: one transaction writes attr and bands, arranges cards into their bands and grows the lane", async () => {
  const { fake, session } = setup(kids().map((c, i) => ({ ...c, props: { plexus: { ...c.props.plexus, x: 10 + i * 5, y: 10 } } })), {});
  assert.equal(await session.bindLane("L", "BT_attrDue"), false, "BT_attr names are refused");
  assert.equal(await session.bindLane("BRD", "Priority"), false, "not a lane");
  assert.equal(await session.bindLane("a", "Priority"), false, "a card is not a lane");
  assert.deepEqual(fake.writesLog(), []);
  assert.equal(await session.bindLane("L", "Priority"), true);
  await fake.flush();
  const p = plexusOf(fake, "L");
  assert.equal(p.attr, "Priority");
  assert.deepEqual(p.bands, ["High", "[[Low]]"], "raw values are kept");
  assert.equal(p.look, "lane");
  assert.ok(p.w >= 600);
  const n = 3;
  const band = (uid) => Math.floor((plexusOf(fake, uid).x + 60) / (p.w / n));
  assert.deepEqual(["a", "b", "c", "d"].map(band), [0, 1, 2, 0]);
  assert.deepEqual(fake.writesLog().map((w) => w[1]).sort(), ["L", "a", "b", "c", "d"], "props only: no attribute written");
  assert.deepEqual(stringWrites(fake), []);
});

test("PXD-11 unbindLane: drops attr and bands only", async () => {
  const { fake, session } = setup(kids());
  assert.equal(await session.unbindLane("L"), true);
  await fake.flush();
  const p = plexusOf(fake, "L");
  assert.equal(p.attr, undefined);
  assert.equal(p.bands, undefined);
  assert.deepEqual([p.look, p.axis, p.w], ["lane", "horizontal", 600]);
  assert.deepEqual(fake.writesLog().map((w) => w[1]), ["L"]);
  assert.equal(await session.unbindLane("L"), false);
});

test("PXD-11 drop: into another band rewrites the first Name:: child; a card with none gets one created", async () => {
  const { fake, session } = setup(kids());
  await session.commitMove(["a"], 200, 0);
  await fake.flush();
  assert.equal(fake.block("a1").string, "Priority:: Low");
  assert.deepEqual(stringWrites(fake), ["a1"], "exactly one attribute write");
  fake.clearLog();
  await session.commitMove(["c"], -400, 0);
  await fake.flush();
  const made = fake.children("c");
  assert.equal(made.length, 1);
  assert.equal(fake.block(made[0]).string, "Priority:: High");
  assert.equal(fake.writesLog().filter((w) => w[0] === "create").length, 1);
  assert.equal(session.board.items.get("c").laneMark.label, "High", "the mark follows at once");
  // The none band clears a single value.
  fake.clearLog();
  await session.commitMove(["b"], 200, 0);
  await fake.flush();
  assert.equal(fake.block("b1").string, "Priority::");
  assert.equal(session.board.items.get("b").laneMark.none, true);
});

test("PXD-11 drop: the same band, a move out of the lane and a resize write no attribute", async () => {
  const { fake, session } = setup(kids());
  await session.commitMove(["a"], 30, 10);
  await fake.flush();
  assert.deepEqual(stringWrites(fake), []);
  await session.commitMove(["b"], 2000, 0);
  await fake.flush();
  assert.deepEqual(stringWrites(fake), []);
  assert.equal(fake.block("b").parent, "BRD", "left the lane");
  assert.equal(fake.block("b1").string, "Priority:: [[Low]]");
  await session.commitRects([{ uid: "a", x: 20, y: 40, w: 300, h: 90 }]);
  await fake.flush();
  assert.deepEqual(stringWrites(fake), []);
});

test("PXD-11 drop: a card with two values rewrites only the first child", async () => {
  const { fake, session } = setup(kids());
  await session.commitMove(["d"], 200, 0);
  await fake.flush();
  assert.equal(fake.block("d1").string, "Priority:: Low");
  assert.equal(fake.block("d2").string, "Priority:: Low", "the second child is untouched");
  assert.deepEqual(stringWrites(fake), ["d1"]);
  fake.clearLog();
  await session.commitMove(["d"], 400, 0);
  await fake.flush();
  assert.deepEqual(stringWrites(fake), [], "two values cannot become none without losing one");
});

test("PXD-11 drop: a value that has no stored band yet is added to bands in the same transaction", async () => {
  const children = kids();
  children[2] = card("c", "Task C", 420, 40, [attr("c1", "Priority:: Urgent")]);
  const { fake, session } = setup(children);
  assert.deepEqual(session.board.items.get("L").laneView.map((b) => b.label), ["High", "Low", "Urgent", "none"]);
  // Four bands now: 150 wide each. A moves from band 0 into band 2 (Urgent).
  await session.commitMove(["a"], 300, 0);
  await fake.flush();
  assert.equal(fake.block("a1").string, "Priority:: Urgent");
  assert.deepEqual(plexusOf(fake, "L").bands, ["High", "Low", "Urgent"]);
});

test("PXD-11 marks: a value cleared in Roam changes the mark, writes nothing and moves nothing", async () => {
  const { fake, session } = setup(kids());
  const at = { ...plexusOf(fake, "a") };
  const dirty = new Set();
  session.on("change", (diff) => { for (const u of diff.dirty) dirty.add(u); });
  await fake.api.data.block.update({ block: { uid: "a1", string: "Priority::" } });
  await fake.flush();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(session.board.items.get("a").laneMark.none, true);
  assert.equal(session.board.items.get("a").laneMark.label, "none");
  assert.ok(dirty.has("a") && dirty.has("L"), "the card and the lane repaint");
  assert.deepEqual(session.board.items.get("L").laneView.map((b) => b.n), [1, 1, 2]);
  fake.clearLog();
  await fake.flush();
  assert.deepEqual(fake.writesLog(), []);
  assert.deepEqual(plexusOf(fake, "a"), at, "the card did not move");
});

test("PXD-11 ref cards: the drop writes the referenced block and the mark shows it at once", async () => {
  const { fake, session } = setup(
    [card("r", "((T))", 20, 40), card("r2", "((U))", 20, 140)],
    BOUND,
    { pages: [{ title: "Src", uid: "SRC", children: [
      { uid: "T", string: "Target", children: [{ uid: "T1", string: "Priority:: High" }] },
      { uid: "U", string: "Other" },
    ] }] },
  );
  assert.equal(session.board.items.get("r").laneMark.label, "High", "read from the referenced block's children");
  await session.commitMove(["r"], 200, 0);
  await session.commitMove(["r2"], 400, 0);
  await fake.flush();
  assert.equal(fake.block("T1").string, "Priority:: Low");
  assert.equal(session.board.items.get("r").laneMark.label, "Low");
  assert.equal(fake.children("r2").length, 0, "nothing is created under the ref card");
  assert.equal(fake.children("U").length, 0, "the none band has no value to write");
  await session.commitMove(["r2"], -400, 0);
  await fake.flush();
  assert.equal(fake.children("U").length, 1);
  assert.equal(fake.block(fake.children("U")[0]).string, "Priority:: High");
  assert.equal(session.board.items.get("r2").laneMark.label, "High");
});

test("PXD-11 undo: a big drag restores values and removes created children", async () => {
  const many = Array.from({ length: 30 }, (_, i) => card(`m${i}`, `M${i}`, 10 + (i % 5) * 30, 10 + Math.floor(i / 5) * 40, i % 2 ? [attr(`v${i}`, "Priority:: High")] : []));
  const { fake, session } = setup(many);
  fake.trackUndo = true;
  const ids = many.map((c) => c.uid);
  await session.commitMove(ids, 200, 0);
  await fake.flush();
  assert.equal(fake.block("v1").string, "Priority:: Low");
  assert.equal(fake.children("m0").length, 1, "a created Name:: child");
  await session.undo();
  await fake.flush();
  assert.equal(fake.block("v1").string, "Priority:: High");
  assert.equal(fake.children("m0").length, 0);
  assert.equal(plexusOf(fake, "m0").x, 10);
});

test("PXD-11 menu: lane entries appear on lane sections only", () => {
  const ids = (items) => items.flatMap((i) => [i.id, ...(i.children || []).map((c) => c.id)]);
  const unbound = buildMenu("section", { lane: { bound: null, fields: ["Priority", "Status"] } });
  const got = ids(unbound);
  assert.ok(got.includes("lane-attr") && got.includes("lane-attr:Priority") && got.includes("lane-attr:Status"));
  assert.ok(!got.includes("lane-stop") && !got.includes("lane-pull"));
  const bound = buildMenu("section", { lane: { bound: "Priority", fields: ["Priority", "Status"] } });
  const items = bound.find((i) => i.id === "lane-attr").children;
  assert.deepEqual(items.map((i) => [i.id, Boolean(i.checked)]), [["lane-attr:Priority", true], ["lane-attr:Status", false]]);
  assert.equal(bound.find((i) => i.id === "lane-stop").label, "Stop sub-lanes (Priority)");
  assert.equal(bound.find((i) => i.id === "lane-pull").label, "Pull blocks with Priority::");
  const empty = buildMenu("section", { lane: { bound: null, fields: [] } }).find((i) => i.id === "lane-attr");
  assert.deepEqual(empty.children.map((c) => [c.label, c.disabled]), [["No Name:: attributes on this board", true]]);
  assert.ok(!ids(buildMenu("section", {})).some((id) => id.startsWith("lane-")), "a plain section has none");
  assert.ok(!ids(buildMenu("card", { item: { type: "card" } })).some((id) => id.startsWith("lane-")));
});

test("PXD-11 pull: blocks with Name:: not on the board become ref cards in their value's band", async () => {
  const { fake, session } = setup(kids(), BOUND, { pages: [{ title: "Src", uid: "SRC", children: [
    { uid: "P1", string: "Pulled one", children: [{ uid: "P1a", string: "Priority:: Low" }] },
    { uid: "P2", string: "Pulled two", children: [{ uid: "P2a", string: "Priority:: Mid" }] },
  ] }] });
  fake.onQuery(/node\/title/, () => [["P1", "Priority:: Low"], ["P2", "Priority:: Mid"], ["a", "Priority:: High"], ["P3", "Not an attribute [[Priority]]"]]);
  const res = await session.pullLaneSource("L");
  await fake.flush();
  assert.deepEqual(res, { placed: 2, total: 2 }, "a is already on the board, P3 has no Name:: prefix");
  const made = fake.children("L").filter((u) => fake.block(u).string.startsWith("(("));
  assert.deepEqual(made.map((u) => fake.block(u).string).sort(), ["((P1))", "((P2))"]);
  assert.deepEqual(plexusOf(fake, "L").bands, ["High", "Low", "Mid"]);
  const p1 = made.find((u) => fake.block(u).string === "((P1))");
  const lanePlexus = plexusOf(fake, "L");
  const w = lanePlexus.w / 4;
  assert.equal(Math.floor((plexusOf(fake, p1).x + 60) / w), 1, "P1 sits in the Low band");
  assert.equal((await session.pullLaneSource("L")).placed, 0, "nothing more to pull");
});
