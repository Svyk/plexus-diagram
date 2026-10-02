import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, extendSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const card = (uid, x, y, w = 200, h = 100, extra = {}) => ({ uid, string: `[[${uid}]]`, props: { plexus: { x, y, w, h, ...extra } } });
const section = (uid, x, y, w, h, children = [], extra = {}) => ({
  uid, string: uid, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children,
});

function setup(children, { settings = null, boardPlexus = { v: 2 } } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { "rf-diagram": { keep: 1 }, plexus: boardPlexus }, children });
  const session = acquireSession("b1", { host, settings, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

// World position of a block, walked through the persisted props (not the session model).
function world(fake, uid) {
  let x = 0;
  let y = 0;
  let cur = uid;
  while (cur && cur !== "b1") {
    const b = fake.block(cur);
    x += b.props.plexus?.x ?? 0;
    y += b.props.plexus?.y ?? 0;
    cur = b.parent;
  }
  return { x, y };
}

const plexus = (fake, uid) => fake.props(uid).plexus;
const updates = (fake) => fake.writesLog().filter((e) => e[0] === "update");

// One section S at (100,100) 400x300 with a (rel 40,60 200x100) and b (rel 250,150 100x80... default min widths do not apply to stored sizes).
const basic = () => [section("S", 100, 100, 400, 300, [card("a", 40, 60), card("b", 240, 150, 120, 80)])];

test("overflow past the bottom grows the section in the same transaction (a props write for the card and one for the section)", async () => {
  const { fake, session } = setup(basic());
  await session.commitRects([{ uid: "a", x: 140, y: 160, w: 200, h: 300 }]);
  assert.equal(updates(fake).length, 2);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 100, y: 100, w: 400, h: 384 });
  assert.deepEqual(world(fake, "b"), { x: 340, y: 250 });
});

test("overflow past the right edge grows the section width", async () => {
  const { fake, session } = setup(basic());
  await session.commitMove(["a"], 250, 0);
  assert.equal(fake.block("a").parent, "S");
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 100, y: 100, w: 514, h: 300 });
  assert.equal(plexus(fake, "a").x, 290);
});

test("overflow past the left edge grows the section left and rebases members so world positions hold", async () => {
  const { fake, session } = setup(basic());
  const bBefore = world(fake, "b");
  await session.commitMove(["a"], -90, 0);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 26, y: 100, w: 474, h: 300 });
  assert.deepEqual(world(fake, "b"), bBefore);
  assert.deepEqual(world(fake, "a"), { x: 50, y: 160 });
  assert.equal(plexus(fake, "b").x, 314);
  assert.equal(session.rects.get("a").x, 50);
});

test("overflow past the top grows the section up and rebases members", async () => {
  const { fake, session } = setup(basic());
  const bBefore = world(fake, "b");
  await session.commitMove(["a"], 0, -90);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 100, y: 46, w: 400, h: 354 });
  assert.deepEqual(world(fake, "b"), bBefore);
  assert.deepEqual(world(fake, "a"), { x: 140, y: 70 });
});

test("growth cascades through nested sections and keeps every world position", async () => {
  const tree = [section("O", 0, 0, 600, 500, [
    section("I", 100, 100, 300, 200, [card("c", 20, 40), card("d", 240, 40, 40, 40)]),
    card("e", 450, 300, 100, 100),
  ])];
  const { fake, session } = setup(tree);
  const before = { d: world(fake, "d"), e: world(fake, "e") };
  await session.commitMove(["c"], -100, 0);
  assert.deepEqual(world(fake, "c"), { x: 20, y: 140 });
  assert.deepEqual(world(fake, "d"), before.d);
  assert.deepEqual(world(fake, "e"), before.e);
  assert.deepEqual(world(fake, "I"), { x: -4, y: 100 });
  assert.deepEqual(world(fake, "O"), { x: -28, y: 0 });
  assert.equal(plexus(fake, "O").w, 628);
  assert.equal(plexus(fake, "I").w, 404);
});

test("cascade to the right: inner then outer grow, one props write each", async () => {
  const tree = [section("O", 0, 0, 600, 500, [section("I", 100, 100, 300, 200, [card("c", 20, 40)])])];
  const { fake, session } = setup(tree);
  await session.commitRects([{ uid: "c", x: 120, y: 140, w: 600, h: 100 }]);
  assert.deepEqual(plexus(fake, "I"), { type: "section", x: 96, y: 100, w: 648, h: 200 });
  assert.equal(plexus(fake, "O").w, 768);
  assert.equal(plexus(fake, "c").x, 24);
  assert.equal(updates(fake).length, 3);
});

test("nothing grows when the moved card stays inside the padded section", async () => {
  const { fake, session } = setup(basic());
  await session.commitMove(["a"], 30, 30);
  assert.equal(fake.writesLog().length, 1);
  assert.equal(fake.writesLog()[0][1], "a");
});

test("the auto-fit-sections setting turns the fit off (plain map and {get} accessors)", async () => {
  for (const settings of [{ "auto-fit-sections": false }, { get: (k) => (k === "auto-fit-sections" ? false : undefined) }]) {
    resetSessions();
    const { fake, session } = setup(basic(), { settings });
    await session.commitMove(["a"], 250, 0);
    assert.equal(fake.writesLog().length, 1);
    assert.equal(plexus(fake, "S").w, 400);
  }
});

test("a section with fit:false does not grow; setFit toggles the flag", async () => {
  const { fake, session } = setup([section("S", 100, 100, 400, 300, [card("a", 40, 60)], { fit: false })]);
  assert.equal(session.board.items.get("S").autofit, false);
  await session.commitMove(["a"], 250, 0);
  assert.equal(fake.writesLog().length, 1);
  await session.setFit("S", true);
  assert.equal(plexus(fake, "S").fit, undefined);
  assert.equal(session.board.items.get("S").autofit, true);
  await session.setFit("S", false);
  assert.equal(plexus(fake, "S").fit, false);
  fake.clearLog();
  await session.setFit("S", false);
  assert.equal(fake.writesLog().length, 0);
  await session.setFit("a", false);
  assert.equal(fake.writesLog().length, 0);
});

test("pinned items ignore commitMove and commitRects; deleteItems skips them unless forced", async () => {
  const { fake, session } = setup([card("p", 0, 0, 200, 100, { pinned: true }), card("q", 500, 0)]);
  assert.equal(session.board.items.get("p").pinned, true);
  await session.commitMove(["p"], 50, 50);
  await session.commitRects([{ uid: "p", x: 10, y: 10, w: 300, h: 300 }]);
  assert.equal(fake.writesLog().length, 0);
  await session.commitMove(["p", "q"], 10, 0);
  assert.equal(fake.writesLog().length, 1);
  assert.equal(plexus(fake, "q").x, 510);
  fake.clearLog();
  await session.deleteItems(["p"]);
  assert.equal(fake.has("p"), true);
  await session.deleteItems(["p"], { force: true });
  assert.equal(fake.has("p"), false);
});

test("deleteItems withContents skips a section that holds a pinned member", async () => {
  const { fake, session } = setup([section("S", 0, 0, 400, 300, [card("p", 40, 60, 200, 100, { pinned: true })])]);
  await session.deleteItems(["S"], { withContents: true });
  assert.equal(fake.has("S"), true);
  await session.deleteItems(["S"], { withContents: true, force: true });
  assert.equal(fake.has("S"), false);
});

test("setPinned writes pinned:true or removes it, one write per changed item", async () => {
  const { fake, session } = setup([card("a", 0, 0), card("b", 300, 0, 200, 100, { pinned: true })]);
  await session.setPinned(["a", "b", "ghost"], true);
  assert.equal(fake.writesLog().length, 1);
  assert.equal(plexus(fake, "a").pinned, true);
  await session.setPinned(["a", "b"], false);
  assert.equal(plexus(fake, "a").pinned, undefined);
  assert.equal(plexus(fake, "b").pinned, undefined);
  assert.equal(session.board.items.get("b").pinned, false);
});

test("createCard, createText and addRefCards inside a section near its edge grow it", async () => {
  const { fake, session } = setup([section("S", 0, 0, 400, 300)]);
  const id = await session.createCard({ x: 200, y: 200, string: "[[N]]" });
  assert.equal(fake.block(id).parent, "S");
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 0, y: 0, w: 504, h: 384 });
  const t = await session.createText({ x: 300, y: 10 });
  assert.equal(fake.block(t).parent, "S");
  const ids = await session.addRefCards([{ string: "((zz))", x: 30, y: 30 }]);
  assert.equal(fake.block(ids[0]).parent, "S");
});

test("growToFit inside a section grows the section", async () => {
  const { fake, session } = setup([section("S", 0, 0, 400, 300, [card("a", 40, 60)])]);
  await session.growToFit("a", 400);
  assert.equal(plexus(fake, "a").h, 400);
  assert.equal(plexus(fake, "S").h, 484);
});

test("createBoard next to a section edge grows the section around the new board card", async () => {
  const { fake, session } = setup([section("S", 0, 0, 400, 300)]);
  const id = await session.createBoard({ rect: { x: 200, y: 150, w: 320, h: 220 }, title: "Sub" });
  assert.equal(fake.block(id).parent, "S");
  assert.equal(plexus(fake, "S").w, 544);
  assert.equal(plexus(fake, "S").h, 394);
});

test("setBoardBackground keeps v, x, y, w, h, unknown keys and rf-diagram; null clears; invalid is rejected", async () => {
  const { fake, session } = setup([card("a", 0, 0)], { boardPlexus: { v: 2, x: 5, y: 6, w: 300, h: 200, zed: 1 } });
  assert.equal(await session.setBoardBackground({ bg: "dots", bgColor: "teal" }), true);
  assert.deepEqual(plexus(fake, "b1"), { v: 2, x: 5, y: 6, w: 300, h: 200, zed: 1, bg: "dots", bgColor: "teal" });
  assert.deepEqual(fake.props("b1")["rf-diagram"], { keep: 1 });
  assert.equal(session.board.background.pattern, "dots");
  fake.clearLog();
  await session.setBoardBackground({ bg: "dots" });
  assert.equal(fake.writesLog().length, 0);
  await session.setBoardBackground({ bg: "grid" });
  assert.equal(plexus(fake, "b1").bgColor, "teal");
  assert.equal(plexus(fake, "b1").bg, "grid");
  fake.clearLog();
  assert.equal(await session.setBoardBackground({ bg: "wavy" }), false);
  assert.equal(await session.setBoardBackground({ bgColor: "chartreuse" }), false);
  assert.equal(fake.writesLog().length, 0);
  await session.setBoardBackground({ bg: null, bgColor: null });
  assert.deepEqual(plexus(fake, "b1"), { v: 2, x: 5, y: 6, w: 300, h: 200, zed: 1 });
  assert.deepEqual(fake.props("b1")["rf-diagram"], { keep: 1 });
});

test("setBoardBackground does nothing on a board that is not enhanced", async () => {
  const { fake, session } = setup([card("a", 0, 0)], { boardPlexus: null });
  assert.equal(session.board.enhanced, false);
  assert.equal(await session.setBoardBackground({ bg: "dots" }), false);
  assert.equal(fake.writesLog().length, 0);
});

test("setCollapsedMany collapses cards and boards only, one write per changed item; collapseAll honours within and except", async () => {
  const tree = [
    card("a", 0, 0),
    card("b", 300, 0, 200, 100, { collapsed: true }),
    { uid: "bd", string: "{{[[diagram]]:Sub}}", props: { plexus: { x: 600, y: 0, v: 2 } } },
    { uid: "t", string: "text", props: { plexus: { type: "text", x: 0, y: 300 } } },
    section("S", 0, 500, 500, 300, [card("m1", 40, 60), card("m2", 300, 60)]),
  ];
  const { fake, session } = setup(tree);
  const n = await session.setCollapsedMany(["a", "b", "bd", "t", "S"], true);
  assert.equal(n, 2);
  assert.equal(fake.writesLog().length, 2);
  assert.equal(plexus(fake, "a").collapsed, true);
  assert.equal(plexus(fake, "bd").collapsed, true);
  assert.equal(plexus(fake, "t").collapsed, undefined);
  fake.clearLog();
  const inSection = await session.collapseAll(true, { within: "S", except: ["m2"] });
  assert.equal(inSection, 1);
  assert.equal(plexus(fake, "m1").collapsed, true);
  assert.equal(plexus(fake, "m2").collapsed, undefined);
  const all = await session.collapseAll(false);
  assert.equal(all, 4);
  assert.equal(plexus(fake, "a").collapsed, undefined);
  assert.equal(plexus(fake, "b").collapsed, undefined);
});

test("tidyItems tidies selected items per parent and writes only x and y", async () => {
  const tree = [
    card("a", 0, 0, 100, 80), card("b", 500, 40, 100, 80), card("c", 900, 300, 100, 80),
    section("S", 0, 600, 600, 400, [card("m1", 200, 100, 100, 80), card("m2", 50, 250, 100, 80)]),
  ];
  const { fake, session } = setup(tree);
  const moved = await session.tidyItems(["a", "b", "c", "m1", "m2"], "row", { gap: 10 });
  assert.equal(moved, 4);
  assert.deepEqual([plexus(fake, "a").x, plexus(fake, "b").x, plexus(fake, "c").x], [0, 110, 220]);
  assert.deepEqual([plexus(fake, "a").y, plexus(fake, "b").y, plexus(fake, "c").y], [0, 0, 0]);
  assert.equal(plexus(fake, "b").w, 100);
  assert.deepEqual([plexus(fake, "m1").x, plexus(fake, "m2").x], [160, 50]);
  assert.deepEqual([plexus(fake, "m1").y, plexus(fake, "m2").y], [100, 100]);
});

test("RG-6: sortOutline matches the visual order and a second pass writes nothing", async () => {
  const tree = [
    card("low", 10, 240, 100, 80),
    card("high", 300, 10, 100, 80),
    section("S", 0, 80, 500, 140, [card("right", 300, 20, 80, 40), card("left", 20, 20, 80, 40)]),
  ];
  const { fake, session } = setup(tree);
  const before = {
    low: plexus(fake, "low"),
    high: plexus(fake, "high"),
    left: plexus(fake, "left"),
  };
  const moves = await session.sortOutline();
  assert.equal(moves > 0, true);
  assert.deepEqual(fake.children("b1"), ["high", "S", "low"]);
  assert.deepEqual(fake.children("S"), ["left", "right"]);
  assert.deepEqual(plexus(fake, "low"), before.low);
  assert.deepEqual(plexus(fake, "high"), before.high);
  assert.deepEqual(plexus(fake, "left"), before.left);
  assert.equal(await session.sortOutline(), 0);
  const undos = () => fake.calls.filter((row) => row[0] === "undo").length;
  await session.undo();
  assert.equal(undos(), moves, "the sort is one undo step, chunked with the other grouped writes");
});

test("tidyItems on one selected section tidies its members; outline follows block order", async () => {
  const tree = [section("S", 0, 0, 800, 600, [card("m1", 300, 300, 100, 80), card("m2", 40, 40, 100, 80), card("m3", 500, 40, 100, 80)])];
  const { fake, session } = setup(tree);
  await session.tidyItems(["S"], "outline", { gap: 20 });
  assert.deepEqual(["m1", "m2", "m3"].map((u) => [plexus(fake, u).x, plexus(fake, u).y]), [[40, 40], [160, 40], [40, 140]]);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 0, y: 0, w: 800, h: 600 });
});

test("sameSize copies the primary's size to the others and respects the mode", async () => {
  const { fake, session } = setup([card("a", 0, 0, 300, 200), card("b", 400, 0, 220, 90), card("c", 800, 0, 250, 120)]);
  assert.equal(await session.sameSize(["a", "b", "c"], "a", "width"), 2);
  assert.deepEqual([plexus(fake, "b").w, plexus(fake, "b").h], [300, 90]);
  assert.deepEqual([plexus(fake, "c").w, plexus(fake, "c").h], [300, 120]);
  await session.sameSize(["b", "c"], "a", "both");
  assert.deepEqual([plexus(fake, "b").w, plexus(fake, "b").h], [300, 200]);
  assert.deepEqual([plexus(fake, "a").w, plexus(fake, "a").h], [300, 200]);
});

test("resetSize writes the default size for each type and reads the default card size from settings", async () => {
  const tree = [card("a", 0, 0, 500, 400), { uid: "t", string: "x", props: { plexus: { type: "text", x: 0, y: 300, w: 500, h: 100 } } }, section("S", 0, 600, 700, 700)];
  const { fake, session } = setup(tree, { settings: { "default-card-width": "320", "default-card-height": 180 } });
  assert.equal(await session.resetSize(["a", "t", "S"]), 3);
  assert.deepEqual([plexus(fake, "a").w, plexus(fake, "a").h], [320, 180]);
  assert.deepEqual([plexus(fake, "t").w, plexus(fake, "t").h], [240, 48]);
  assert.deepEqual([plexus(fake, "S").w, plexus(fake, "S").h], [480, 320]);
  fake.clearLog();
  assert.equal(await session.resetSize(["a"]), 0);
  assert.equal(fake.writesLog().length, 0);
});

test("fitToContent sets the height in both directions, clamped between the minimum and 900", async () => {
  const { fake, session } = setup([card("a", 0, 0, 280, 160), section("S", 0, 400, 400, 300)]);
  await session.fitToContent("a", 400.2);
  assert.equal(plexus(fake, "a").h, 401);
  await session.fitToContent("a", 100);
  assert.equal(plexus(fake, "a").h, 100);
  await session.fitToContent("a", 10);
  assert.equal(plexus(fake, "a").h, 80);
  await session.fitToContent("a", 5000);
  assert.equal(plexus(fake, "a").h, 900);
  fake.clearLog();
  await session.fitToContent("a", 900);
  await session.fitToContent("S", 50);
  assert.equal(fake.writesLog().length, 0);
});

test("fitSection shrinks to the members plus padding, rebases them, and only grows ancestors", async () => {
  const tree = [section("O", 0, 0, 700, 600, [section("S", 50, 50, 600, 500, [card("a", 40, 60, 200, 100), card("b", 300, 80, 200, 100)])])];
  const { fake, session } = setup(tree);
  const before = { a: world(fake, "a"), b: world(fake, "b") };
  assert.equal(await session.fitSection("S"), true);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 66, y: 86, w: 508, h: 168 });
  assert.deepEqual(world(fake, "a"), before.a);
  assert.deepEqual(world(fake, "b"), before.b);
  assert.deepEqual(plexus(fake, "O"), { type: "section", x: 0, y: 0, w: 700, h: 600 });
  assert.equal(await session.fitSection("O"), true);
  assert.deepEqual(world(fake, "a"), before.a);
});

test("fitSection with shrink:false only grows; an empty section reports false", async () => {
  const tree = [section("S", 0, 0, 600, 500, [card("a", 40, 60), card("b", 300, 80)]), section("E", 900, 0, 200, 200)];
  const { fake, session } = setup(tree);
  fake.clearLog();
  assert.equal(await session.fitSection("S", { shrink: false }), true);
  assert.equal(fake.writesLog().length, 0);
  assert.equal(await session.fitSection("E"), false);
  assert.equal(await session.fitSection("a"), false);
});

test("space-out pushes overlapping siblings after a move and writes only the displaced item", async () => {
  const { fake, session } = setup([card("a", 0, 0, 280, 160), card("b", 400, 0, 280, 160)], { settings: { "space-out": true } });
  await session.commitMove(["a"], 300, 0);
  assert.equal(plexus(fake, "a").x, 300);
  assert.deepEqual([plexus(fake, "b").x, plexus(fake, "b").y], [400, 176]);
  assert.equal(updates(fake).length, 2);
});

test("space-out is off by default and never displaces a pinned neighbour", async () => {
  const off = setup([card("a", 0, 0, 280, 160), card("b", 400, 0, 280, 160)]);
  await off.session.commitMove(["a"], 300, 0);
  assert.equal(plexus(off.fake, "b").y, 0);
  resetSessions();
  const on = setup([card("a", 0, 0, 280, 160), card("b", 400, 0, 280, 160, { pinned: true })], { settings: { "space-out": true } });
  await on.session.commitMove(["a"], 300, 0);
  assert.equal(plexus(on.fake, "b").y, 0);
});

test("space-out inside a section uses section-relative coordinates and re-fits the section", async () => {
  const tree = [section("S", 100, 100, 600, 300, [card("a", 24, 60, 200, 100), card("b", 300, 60, 200, 100)])];
  const { fake, session } = setup(tree, { settings: { "space-out": true } });
  await session.commitMove(["a"], 280, 0);
  assert.deepEqual([plexus(fake, "b").x, plexus(fake, "b").y], [300, 176]);
  assert.equal(plexus(fake, "S").h, 300);
});

test("space-out: a pinned card that already overlaps another does not push it when an unrelated card moves", async () => {
  const tree = [card("P", 0, 0, 280, 160, { pinned: true }), card("C", 100, 50, 200, 100), card("X", 1000, 0, 200, 100)];
  const { fake, session } = setup(tree, { settings: { "space-out": true } });
  await session.commitMove(["X"], 10, 0);
  assert.deepEqual([plexus(fake, "C").x, plexus(fake, "C").y], [100, 50], "C was never touched");
  assert.equal(updates(fake).length, 1, "only the moved card is written");
});

test("a pinned section is never grown or moved by a member that leaves its edge", async () => {
  const tree = [section("S", 100, 100, 400, 300, [card("a", 40, 60), card("b", 240, 150, 120, 80)], { pinned: true })];
  const { fake, session } = setup(tree);
  await session.commitMove(["a"], -90, 0);
  assert.deepEqual(plexus(fake, "S"), { type: "section", x: 100, y: 100, w: 400, h: 300, pinned: true });
  assert.equal(updates(fake).length, 1, "only the card is written");
  resetSessions();
  const grow = setup(tree.map((n) => ({ ...n })));
  await grow.session.commitMove(["a"], 250, 0);
  assert.deepEqual(plexus(grow.fake, "S"), { type: "section", x: 100, y: 100, w: 400, h: 300, pinned: true });
});

test("resetSize and sameSize never shrink a section below its members", async () => {
  const tree = [
    section("S", 0, 0, 900, 700, [card("a", 20, 20, 200, 100), card("b", 600, 400, 280, 160)]),
    section("T", 1200, 0, 300, 200),
  ];
  const { fake, session } = setup(tree);
  await session.resetSize(["S"]);
  assert.deepEqual([plexus(fake, "S").w, plexus(fake, "S").h], [904, 584], "default 480x320 grows to the members' far edges plus padding");
  await session.sameSize(["T", "S"], "T", "both");
  assert.deepEqual([plexus(fake, "S").w, plexus(fake, "S").h], [904, 584], "matching the smaller section keeps the members inside");
  assert.deepEqual([plexus(fake, "T").w, plexus(fake, "T").h], [300, 200]);
  await session.resetSize(["T"]);
  assert.deepEqual([plexus(fake, "T").w, plexus(fake, "T").h], [480, 320], "an empty section still takes the default");
});

test("addDailyCards creates a row of daily-page cards 300 apart and skips titles already on the board", async () => {
  const { fake, session } = setup([{ uid: "d29", string: "[[September 29th, 2026]]", props: { plexus: { x: 0, y: 0 } } }]);
  const ids = await session.addDailyCards(["2026-09-29", "2026-09-30", new Date(2026, 9, 1), "2026-09-30"], { x: 100, y: 500 });
  assert.equal(ids.length, 2);
  assert.equal(fake.block(ids[0]).string, "[[September 30th, 2026]]");
  assert.equal(fake.block(ids[1]).string, "[[October 1st, 2026]]");
  assert.deepEqual([plexus(fake, ids[0]).x, plexus(fake, ids[1]).x], [100, 400]);
  assert.equal(plexus(fake, ids[0]).y, 500);
  assert.deepEqual(await session.addDailyCards(["2026-09-30"], { x: 0, y: 0 }), []);
});

test("addDailyCards never lands a new card on top of an existing one (Add this week over today's card)", async () => {
  const { fake, session } = setup([{ uid: "d29", string: "[[September 29th, 2026]]", props: { plexus: { x: 133, y: 802, w: 280, h: 160 } } }]);
  const ids = await session.addDailyCards(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"], { x: 133, y: 802 });
  assert.equal(ids.length, 3, "today's card is skipped");
  const xs = ids.map((id) => plexus(fake, id).x);
  assert.ok(xs.every((x) => x >= 133 + 280), `none overlaps the card at x=133 (${xs})`);
  assert.equal(new Set(xs).size, 3, "and none overlaps another new card");
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 280);
});

test("extendSession hands every new session the api and the new methods exist on the session", async () => {
  const seen = [];
  const off = extendSession((session, api) => { seen.push({ session, api }); });
  const { fake, session } = setup([card("a", 0, 0)], { settings: { "space-out": true } });
  assert.equal(seen.length, 1);
  const { api } = seen[0];
  assert.equal(seen[0].session, session);
  for (const key of ["uid", "host", "settings", "txn", "rawNode", "ix", "kidsOf", "rawPlexus", "itemPlexus", "edgePlexus", "insertOrder",
    "ensureContainer", "edgeStringFor", "refOf", "applyFit", "board", "rects", "queue", "isGone", "setting", "clone", "round1", "emit"]) {
    assert.ok(key in api, key);
  }
  assert.equal(api.uid, "b1");
  assert.equal(api.board(), session.board);
  assert.equal(api.rects(), session.rects);
  assert.equal(api.isGone(), false);
  assert.equal(api.setting("space-out", false), true);
  assert.equal(api.setting("nope", 7), 7);
  assert.equal(api.round1(1.26), 1.3);
  assert.deepEqual(api.clone({ a: [1] }), { a: [1] });
  assert.equal(api.rawNode("a")[":block/uid"], "a");
  assert.equal(api.rawPlexus("a").x, 0);
  await api.txn((t) => t.props("a", api.itemPlexus("a", { x: 77 })));
  assert.equal(plexus(fake, "a").x, 77);
  for (const m of ["fitSection", "setFit", "setPinned", "setBoardBackground", "setCollapsedMany", "collapseAll", "tidyItems", "sameSize", "resetSize", "fitToContent", "addDailyCards"]) {
    assert.equal(typeof session[m], "function", m);
  }
  off();
  resetSessions();
  setup([card("a", 0, 0)]);
  assert.equal(seen.length, 1);
});

test("a throwing extension does not stop session creation", () => {
  const off = extendSession(() => { throw new Error("boom"); });
  const log = console.error;
  console.error = () => {};
  try {
    const { session } = setup([card("a", 0, 0)]);
    assert.equal(session.board.items.size, 1);
  } finally {
    console.error = log;
    off();
  }
});

test("applyFit from the extension api grows a section for touched uids inside the caller's txn", async () => {
  let api;
  const off = extendSession((_s, a) => { api = a; });
  const { fake, session } = setup([section("S", 0, 0, 400, 300, [card("a", 40, 60)])]);
  off();
  await api.txn((t) => {
    t.props("a", api.itemPlexus("a", { x: 380 }));
    api.applyFit(t, ["a"]);
  });
  assert.equal(plexus(fake, "S").w, 604);
  assert.equal(session.rects.get("a").x, 380);
});

test("one drag past a section edge is one undo step (card + section writes grouped)", async () => {
  const { fake, host, session } = setup(basic());
  await session.commitMove(["a"], 250, 0);
  assert.equal(updates(fake).length, 2);
  fake.calls.length = 0;
  await session.undo();
  assert.deepEqual(fake.calls.filter((c) => c[0] === "undo" || c[0] === "redo").map((c) => c[0]), ["undo", "undo"], "both writes are undone by one Cmd+Z");
  fake.calls.length = 0;
  await session.redo();
  assert.deepEqual(fake.calls.filter((c) => c[0] === "redo").length, 2);
  assert.ok(host.stats.writes >= 2);
});
