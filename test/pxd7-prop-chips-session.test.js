// PXD-7: property chips through the session (board prop write, lazy card reads) and the board menu.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-chips.js";
import { buildMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const card = (uid, string, x, y, children = []) => ({ uid, string, props: { plexus: { x, y, w: 120, h: 60 } }, children });
const attr = (uid, string) => ({ uid, string });

function setup(children, plexus = { v: 2 }, { pages = [], enhanced = true } = {}) {
  const fake = createFakeRoam({ echoDelay: 0 });
  for (const page of pages) fake.seedPage(page);
  fake.seedBoard({ uid: "BRD", props: enhanced ? { plexus } : {}, children });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  let pulls = 0;
  const real = host.pullTree.bind(host);
  host.pullTree = (...args) => { pulls += 1; return real(...args); };
  const session = acquireSession("BRD", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session, pulls: () => pulls };
}
const plexusOf = (fake, uid) => fake.props(uid)?.plexus;

const cards = () => [
  card("a", "Task A", 20, 40, [attr("a1", "Status:: [[Doing]]"), attr("a2", "Author:: Ada")]),
  card("b", "Task B", 220, 40, [attr("b1", "Status:: #todo #urgent")]),
  card("c", "Task C", 420, 40),
];

test("PXD-7 setBoardChips: writes only the board's chips key and keeps the others", async () => {
  const { fake, session } = setup(cards(), { v: 2, bg: "dots", lodZoom: 0.5 });
  assert.equal(await session.setBoardChips(["Status", "Author"]), true);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "BRD"), { v: 2, bg: "dots", lodZoom: 0.5, chips: ["Status", "Author"] });
  assert.deepEqual([...new Set(fake.writesLog().map((w) => w[1]))], ["BRD"]);
  assert.deepEqual(session.board.chips, ["Status", "Author"]);
  fake.clearLog();
  assert.equal(await session.setBoardChips(["Status", "Author"]), true);
  assert.deepEqual(fake.writesLog(), [], "same list writes nothing");
  assert.equal(await session.setBoardChips([]), true);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "BRD"), { v: 2, bg: "dots", lodZoom: 0.5 }, "clearing removes the key");
  assert.deepEqual(session.board.chips, []);
});

test("PXD-7 setBoardChips: a board that is not enhanced refuses", async () => {
  const { fake, session } = setup(cards(), {}, { enhanced: false });
  assert.equal(await session.setBoardChips(["Status"]), false);
  assert.deepEqual(fake.writesLog(), []);
});

test("PXD-7 toggleBoardChip: adds, removes, refuses past six", async () => {
  const { fake, session } = setup(cards());
  assert.equal(await session.toggleBoardChip("Status"), true);
  await fake.flush();
  assert.deepEqual(session.board.chips, ["Status"]);
  assert.equal(await session.toggleBoardChip("Status"), true);
  await fake.flush();
  assert.deepEqual(session.board.chips, []);
  await session.setBoardChips(["a", "b", "c", "d", "e", "f"]);
  await fake.flush();
  assert.equal(await session.toggleBoardChip("g"), false);
  assert.equal(await session.toggleBoardChip("BT_attrDue"), false);
});

test("PXD-7 cardPropChips: own-child attrs in picked order", async () => {
  const { fake, session } = setup(cards());
  await session.setBoardChips(["Author", "Status"]);
  await fake.flush();
  assert.deepEqual(session.cardPropChips("a"), [{ name: "Author", text: "Ada" }, { name: "Status", text: "Doing" }]);
  assert.deepEqual(session.cardPropChips("b"), [{ name: "Status", text: "todo, urgent" }]);
  assert.deepEqual(session.cardPropChips("c"), []);
  assert.deepEqual(session.cardPropChips("nope"), []);
});

test("PXD-7 cardPropChips: a block-ref card reads the referenced block's children", async () => {
  const { fake, session } = setup(
    [card("r", "((T))", 20, 40), card("r2", "((U))", 220, 40)],
    { v: 2 },
    { pages: [{ title: "Src", uid: "SRC", children: [
      { uid: "T", string: "Target", children: [{ uid: "T1", string: "Status:: Review" }] },
      { uid: "U", string: "Other" },
    ] }] },
  );
  await session.setBoardChips(["Status"]);
  await fake.flush();
  assert.deepEqual(session.cardPropChips("r"), [{ name: "Status", text: "Review" }]);
  assert.deepEqual(session.cardPropChips("r2"), []);
});

test("PXD-7 cardPropChips: a page card reads the page's top-level attrs after its own", async () => {
  const { fake, session } = setup(
    [card("p", "[[Src]]", 20, 40, [attr("p1", "Status:: Own")]), card("p2", "[[Src2]]", 220, 40)],
    { v: 2 },
    { pages: [
      { title: "Src", uid: "SRC", children: [{ uid: "S1", string: "Status:: Page" }, { uid: "S2", string: "Author:: Grace" }] },
      { title: "Src2", uid: "SRC2", children: [{ uid: "S3", string: "Status:: Only page" }] },
    ] },
  );
  await session.setBoardChips(["Status", "Author"]);
  await fake.flush();
  // The fake pull carries no page-ref uid (Roam's does), so set it the way the board build would.
  session.board.items.get("p").target.uid = "SRC";
  session.board.items.get("p2").target.uid = "SRC2";
  assert.deepEqual(session.cardPropChips("p"), [{ name: "Status", text: "Own" }, { name: "Author", text: "Grace" }]);
  assert.deepEqual(session.cardPropChips("p2"), [{ name: "Status", text: "Only page" }]);
});

test("PXD-7 no picks: no host reads at all", async () => {
  const { session, pulls } = setup([card("r", "((T))", 20, 40), ...cards()], { v: 2 }, { pages: [{ title: "Src", uid: "SRC", children: [{ uid: "T", string: "Target", children: [{ uid: "T1", string: "Status:: Review" }] }] }] });
  const before = pulls();
  assert.deepEqual(session.cardPropChips("r"), []);
  assert.deepEqual(session.cardPropChips("a"), []);
  assert.equal(pulls(), before);
});

test("PXD-7 chipFieldsFor: picked names first, then names on cards, no BT_attr", async () => {
  const { fake, session } = setup([...cards(), card("d", "Task D", 20, 140, [attr("d1", "BT_attrDue:: x"), attr("d2", "Zeta:: 1")])]);
  assert.deepEqual(session.chipFieldsFor().slice().sort(), ["Author", "Status", "Zeta"]);
  await session.setBoardChips(["Zeta"]);
  await fake.flush();
  const fields = session.chipFieldsFor();
  assert.equal(fields[0], "Zeta");
  assert.ok(fields.includes("Status") && fields.includes("Author"));
  assert.ok(!fields.includes("BT_attrDue"));
});

test("PXD-7 chipFieldsFor: one scan per board build, so opening the menu again reads nothing", () => {
  const { session, pulls } = setup([card("r", "((T))", 20, 40), ...cards()], { v: 2 }, { pages: [{ title: "Src", uid: "SRC", children: [{ uid: "T", string: "Target", children: [{ uid: "T1", string: "Kind:: Review" }] }] }] });
  const first = session.chipFieldsFor();
  assert.ok(first.includes("Kind"));
  const after = pulls();
  assert.ok(after > 0);
  assert.deepEqual(session.chipFieldsFor(), first);
  assert.equal(pulls(), after);
});

test("PXD-7 menu: Card properties shows checked names, Hide all only when something is picked", () => {
  const ids = (items) => items.flatMap((i) => [i.id, ...(i.children || []).map((c) => c.id)]);
  const find = (items, id) => items.find((i) => i.id === id);
  const none = buildMenu("board-menu", { chips: { picked: [], fields: ["Status", "Author"] } });
  const sub = find(none, "prop-chips");
  assert.ok(sub);
  assert.deepEqual(sub.children.map((c) => [c.id, c.checked === true]), [["prop-chip:Status", false], ["prop-chip:Author", false]]);
  assert.ok(!ids(none).includes("prop-chip-clear"));
  const some = buildMenu("board-menu", { chips: { picked: ["Author"], fields: ["Status"] } });
  const kids = find(some, "prop-chips").children;
  assert.deepEqual(kids.filter((c) => c.id.startsWith("prop-chip:")).map((c) => [c.id, c.checked === true]), [["prop-chip:Status", false], ["prop-chip:Author", true]]);
  assert.ok(kids.some((c) => c.id === "prop-chip-clear"));
  const empty = buildMenu("board-menu", { chips: { picked: [], fields: [] } });
  assert.equal(find(empty, "prop-chips").children[0].disabled, true);
});
