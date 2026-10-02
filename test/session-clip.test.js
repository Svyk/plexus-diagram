import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard } from "../src/model/board.js";
import "../src/session-clip.js";

afterEach(() => resetSessions());

const card = (uid, string, x, y, w = 200, h = 100, extra = {}, children = []) => ({
  uid, string, props: { plexus: { x, y, w, h, ...extra } }, children,
});
const section = (uid, x, y, w, h, children = [], extra = {}) => ({
  uid, string: uid, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children,
});
const edge = (uid, from, to, string) => ({ uid, string, props: { plexus: { type: "edge", from, to } } });
const edges = (uid, children) => ({ uid, string: "Connections", props: { plexus: { type: "edges" } }, open: false, children });

function mainChildren() {
  return [
    card("N", "Note text", 100, 100, 200, 100, { color: "teal", collapsed: true }, [
      { uid: "K1", string: "see ((K2))", props: { foo: "bar" } },
      { uid: "K2", string: "second", children: [{ uid: "K3", string: "third" }] },
    ]),
    card("P", "[[Page A]]", 400, 100, 280, 160, { pinned: true }),
    section("S", 0, 400, 500, 300, [
      card("m1", "member one", 20, 40, 200, 100, {}, [{ uid: "mk", string: "member kid" }]),
      card("m2", "[[Page B]]", 260, 60, 200, 100, { pinned: true }),
    ]),
    card("NB", "{{[[diagram]]:Full}}", 600, 400, 320, 220, { v: 2 }, [
      card("nc1", "[[Z]]", 10, 0),
      edges("NBE", []),
    ]),
    card("NN", "{{[[diagram]]}}", 1000, 400, 320, 220),
    edges("EC", [edge("e1", "m1", "m2", "((m1)) → [[Page B]]"), edge("e2", "N", "P", "((N)) → [[Page A]]")]),
  ];
}

function setup(children = mainChildren(), { extra } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  extra?.(fake);
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

const plexus = (fake, uid) => fake.props(uid).plexus;
const creates = (fake) => fake.writesLog().filter((e) => e[0] === "create");
const updates = (fake) => fake.writesLog().filter((e) => e[0] === "update");
const strings = (fake, uids) => uids.map((u) => fake.block(u).string);

// Strings of a block's whole subtree, in outline order.
function subtree(fake, uid) {
  const b = fake.block(uid);
  return { string: b.string, children: b.children.map((c) => subtree(fake, c)) };
}

test("duplicateItems clones a note with its children: fresh uids, remapped refs, layout kept, one create per block", async () => {
  const { fake, session } = setup();
  const made = await session.duplicateItems(["N"]);
  assert.equal(made.length, 1);
  const [copy] = made;
  assert.notEqual(copy, "N");
  assert.equal(creates(fake).length, 4);
  assert.equal(updates(fake).length, 0);
  assert.equal(fake.block(copy).parent, "b1");
  assert.deepEqual(plexus(fake, copy), { x: 124, y: 124, w: 200, h: 100, color: "teal", collapsed: true });
  const [k1, k2] = fake.children(copy);
  assert.deepEqual([k1, k2].map((u) => u.startsWith("gen")), [true, true]);
  assert.equal(fake.block(k1).string, `see ((${k2}))`, "the ref to the cloned sibling points at the clone");
  const [k3] = fake.children(k2);
  assert.equal(fake.block(k3).string, "third");
  assert.equal(fake.block("N").string, "Note text");
  const root = fake.children("b1");
  assert.equal(root.at(-1), "EC", "Connections stays last");
  assert.equal(root.indexOf(copy), root.indexOf("EC") - 1);
});

test("duplicateItems clones a section with its members and the connection between them", async () => {
  const { fake, session } = setup();
  const [copy] = await session.duplicateItems(["S"]);
  assert.equal(creates(fake).length, 5, "section, two members, one member child, one edge");
  assert.equal(updates(fake).length, 0);
  assert.deepEqual(plexus(fake, copy), { type: "section", x: 24, y: 424, w: 500, h: 300 });
  assert.equal(fake.block(copy).parent, "b1", "a section never nests into itself");
  const [m1, m2] = fake.children(copy);
  assert.deepEqual(plexus(fake, m1), { x: 20, y: 40, w: 200, h: 100 });
  assert.equal(fake.block(m2).string, "[[Page B]]");
  const container = fake.children("EC");
  assert.equal(container.length, 3);
  const made = container[2];
  assert.deepEqual(plexus(fake, made), { type: "edge", from: m1, to: m2 });
  assert.equal(fake.block(made).string, `((${m1})) → [[Page B]]`);
  assert.equal(fake.block(made).parent, "EC");
  assert.equal(fake.children("b1").at(-1), "EC");
});

test("duplicateItems does not copy the pinned flag, also not on section members", async () => {
  const { fake, session } = setup();
  const [p] = await session.duplicateItems(["P"]);
  assert.deepEqual(plexus(fake, p), { x: 424, y: 124, w: 280, h: 160 });
  assert.equal(plexus(fake, "P").pinned, true);
  const [s] = await session.duplicateItems(["S"]);
  const m2 = fake.children(s)[1];
  assert.equal(plexus(fake, m2).pinned, undefined);
  assert.equal(plexus(fake, "m2").pinned, true);
});

test("duplicateItems with asRef creates one plain ref card per original", async () => {
  const { fake, session } = setup();
  const made = await session.duplicateItems(["N", "P", "S"], { asRef: true, dx: 10, dy: 20 });
  assert.equal(made.length, 3);
  assert.deepEqual(strings(fake, made), ["((N))", "[[Page A]]", "((S))"]);
  assert.equal(creates(fake).length, 3);
  assert.deepEqual(plexus(fake, made[0]), { x: 110, y: 120 });
  assert.deepEqual(plexus(fake, made[1]), { x: 410, y: 120 });
  assert.equal(fake.children(made[0]).length, 0);
  assert.equal(fake.block(made[2]).parent, "b1", "a ref to a section stays outside that section");
});

test("duplicateItems chooses the parent from the copy's center and grows a section that the copy overflows", async () => {
  const tree = [section("T", 0, 0, 300, 200, [card("a", "note a", 20, 20)])];
  const first = setup(tree);
  const [inside] = await first.session.duplicateItems(["a"], { dx: 150, dy: 60 });
  assert.equal(first.fake.block(inside).parent, "T");
  assert.deepEqual(plexus(first.fake, inside), { x: 170, y: 80, w: 200, h: 100 });
  assert.equal(creates(first.fake).length, 1);
  assert.equal(updates(first.fake).length, 1);
  assert.deepEqual(plexus(first.fake, "T"), { type: "section", x: 0, y: 0, w: 394, h: 204 });
  resetSessions();
  const second = setup(tree);
  const [outside] = await second.session.duplicateItems(["a"], { dx: 400, dy: 0 });
  assert.equal(second.fake.block(outside).parent, "b1");
  assert.deepEqual(plexus(second.fake, outside), { x: 420, y: 20, w: 200, h: 100 });
  assert.equal(updates(second.fake).length, 0);
});

test("duplicateItems skips a non-enhanced nested board and ignores unknown uids", async () => {
  const { fake, session } = setup();
  assert.deepEqual(await session.duplicateItems(["NN"]), []);
  assert.deepEqual(await session.duplicateItems(["ghost"]), []);
  assert.equal(fake.writesLog().length, 0);
});

test("duplicateItems clones an enhanced nested board with its inner cards", async () => {
  const { fake, session } = setup();
  const [copy] = await session.duplicateItems(["NB"]);
  assert.equal(plexus(fake, copy).v, 2);
  assert.equal(creates(fake).length, 3);
  assert.deepEqual(strings(fake, fake.children(copy)), ["[[Z]]", "Connections"]);
});

const payloadOf = (extra = {}) => ({
  v: 1,
  board: "elsewhere",
  bounds: { x: 100, y: 100, w: 580, h: 160 },
  items: [
    { uid: "N", type: "card", kind: "note", string: "Note text", target: { kind: "self", uid: "N" }, x: 100, y: 100, w: 200, h: 100, color: "teal" },
    { uid: "P", type: "card", kind: "page", string: "[[Page A]]", target: { kind: "page", title: "Page A" }, x: 400, y: 120, w: 280, h: 160 },
  ],
  ...extra,
});

test("pasteItems in refs mode keeps relative offsets, sizes and colors and accepts the parseClipboard wrapper", async () => {
  const { fake, session } = setup();
  const made = await session.pasteItems({ kind: "plexus", data: payloadOf() }, { x: 1500, y: 0, mode: "refs" });
  assert.equal(made.length, 2);
  assert.deepEqual(strings(fake, made), ["((N))", "[[Page A]]"]);
  assert.deepEqual(plexus(fake, made[0]), { x: 1500, y: 0, w: 200, h: 100, color: "teal" });
  assert.deepEqual(plexus(fake, made[1]), { x: 1800, y: 20, w: 280, h: 160 });
  assert.equal(creates(fake).length, 2);
  assert.deepEqual(await session.pasteItems({ items: [] }, { x: 0, y: 0 }), []);
  assert.deepEqual(await session.pasteItems(null), []);
});

test("pasteItems in clone mode clones from this board when the payload names it", async () => {
  const { fake, session } = setup();
  const made = await session.pasteItems(payloadOf({ board: "b1" }), { x: 1500, y: 600, mode: "clone" });
  assert.equal(made.length, 2);
  assert.deepEqual(plexus(fake, made[0]), { x: 1500, y: 600, w: 200, h: 100, color: "teal", collapsed: true });
  assert.equal(fake.children(made[0]).length, 2);
  assert.equal(fake.block(made[1]).string, "[[Page A]]");
  assert.deepEqual(plexus(fake, made[1]), { x: 1800, y: 620, w: 280, h: 160 }, "pinned is dropped");
  assert.equal(creates(fake).length, 6, "note subtree, page card and the cloned connection");
  const container = fake.children("EC");
  assert.equal(container.length, 3, "the N -> P connection is cloned too");
  assert.deepEqual(plexus(fake, container[2]), { type: "edge", from: made[0], to: made[1] });
  assert.equal(fake.block(container[2]).string, `((${made[0]})) → [[Page A]]`);
});

test("a cut is a move: the snapshot survives the delete, so a plain paste restores notes, sections and their connections", async () => {
  const { fake, session } = setup();
  const snapshot = session.snapshotItems(["N", "S"]);
  assert.ok(snapshot, "snapshot taken");
  const data = payloadOf({ board: "b1", items: [
    { uid: "N", type: "card", kind: "note", string: "Note text", target: { kind: "self", uid: "N" }, x: 100, y: 100, w: 200, h: 100, color: "teal" },
    { uid: "S", type: "section", kind: "section", string: "S", target: { kind: "self", uid: "S" }, x: 0, y: 400, w: 500, h: 300 },
  ], bounds: { x: 0, y: 100, w: 500, h: 600 }, snapshot });
  await session.deleteItems(["N", "S"], { withContents: true });
  assert.equal(fake.block("N"), null, "the source blocks are gone");
  fake.clearLog();
  for (const mode of ["refs", "clone"]) {
    const made = await session.pasteItems(JSON.parse(JSON.stringify(data)), { x: 2000, y: 0, mode });
    assert.equal(made.length, 2, `${mode}: both items come back`);
    assert.equal(fake.block(made[0]).string, "Note text", `${mode}: the note keeps its text, not a dead ((ref))`);
    assert.equal(fake.children(made[0]).length, 2, `${mode}: the note keeps its children`);
    assert.equal(fake.block(made[1]).string, "S");
    assert.equal(fake.children(made[1]).length, 2, `${mode}: the section keeps its members`);
  }
  assert.equal(fake.block("N"), null);
});

test("snapshotItems carries connections between the copied items only, and refuses an empty selection", () => {
  const { session } = setup();
  const snap = session.snapshotItems(["S"]);
  const container = snap[":block/children"].find((c) => c[":block/props"]?.plexus?.type === "edges");
  assert.equal(container[":block/children"].length, 1, "m1 -> m2 is inside the section");
  const solo = session.snapshotItems(["N"]);
  assert.equal(solo[":block/children"].some((c) => c[":block/props"]?.plexus?.type === "edges"), false, "N -> P leaves the copy");
  assert.equal(session.snapshotItems([]), null);
});

test("pasteItems in clone mode pulls another board, skips missing uids and creates the Connections block", async () => {
  const other = (fake) => fake.seedBoard({
    uid: "b2",
    props: { plexus: { v: 2 } },
    children: [
      card("X", "note x", 50, 60, 200, 100, {}, [{ uid: "XK", string: "x kid ((X))" }]),
      card("Y", "[[Y page]]", 300, 60),
      edges("EC2", [edge("xy", "X", "Y", "((X)) → [[Y page]]")]),
    ],
  });
  const { fake, session } = setup([card("only", "solo", 0, 0)], { extra: other });
  const data = {
    v: 1,
    board: "b2",
    bounds: { x: 50, y: 60, w: 450, h: 100 },
    items: [
      { uid: "X", x: 50, y: 60, w: 200, h: 100 },
      { uid: "Y", x: 300, y: 60, w: 200, h: 100 },
      { uid: "ghost", x: 0, y: 0, w: 10, h: 10 },
    ],
  };
  const made = await session.pasteItems(data, { x: 1000, y: 500, mode: "clone" });
  assert.equal(made.length, 2, "the missing uid is skipped");
  assert.deepEqual(plexus(fake, made[0]), { x: 1000, y: 500, w: 200, h: 100 });
  assert.deepEqual(plexus(fake, made[1]), { x: 1250, y: 500, w: 200, h: 100 });
  const [xk] = fake.children(made[0]);
  assert.equal(fake.block(xk).string, `x kid ((${made[0]}))`, "refs into the cloned subtree are remapped");
  const root = fake.children("b1");
  const container = root.at(-1);
  assert.deepEqual(plexus(fake, container), { type: "edges" });
  assert.equal(fake.block(container).string, "Connections");
  assert.deepEqual(fake.children(container).map((u) => plexus(fake, u)), [{ type: "edge", from: made[0], to: made[1] }]);
  assert.deepEqual(root.slice(0, 3), ["only", made[0], made[1]], "cards stay before Connections");
  assert.deepEqual(fake.children("b2"), ["X", "Y", "EC2"], "the source board is untouched");
});

test("pasteText and addRefCards stop at 45 cards so Roam's 50-entry undo can reach them", async () => {
  const { session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  const many = Array.from({ length: 50 }, (_, i) => `idea ${i}`).join("\n");
  assert.equal((await session.pasteText(many, { x: 0, y: 0 })).length, 45);
  assert.deepEqual(toasts, ["Added 45 of 50 (Roam undo holds 50 changes)"]);
  const refs = Array.from({ length: 46 }, (_, i) => ({ string: `((r${i}))`, x: 0, y: 0 }));
  assert.equal((await session.addRefCards(refs)).length, 45);
  assert.equal(toasts.length, 2);
  assert.equal((await session.addRefCards(refs.slice(0, 45))).length, 45);
  assert.equal(toasts.length, 2, "45 exactly is not capped");
});

test("pasteText stacks one card per line and keeps refs as refs", async () => {
  const { fake, session } = setup();
  const made = await session.pasteText("- first idea\n\n[[Some Page]]\n((abc123))\n", { x: 2000, y: 100 });
  assert.equal(made.length, 3);
  assert.deepEqual(strings(fake, made), ["first idea", "[[Some Page]]", "((abc123))"]);
  assert.deepEqual(made.map((u) => plexus(fake, u)), [{ x: 2000, y: 100, look: "block" }, { x: 2000, y: 284 }, { x: 2000, y: 468 }]);
  assert.equal(creates(fake).length, 3);
  assert.deepEqual(await session.pasteText("   \n\n", { x: 0, y: 0 }), []);
  const again = await session.pasteText([{ string: "from entries" }], { x: 0, y: 900 });
  assert.equal(fake.block(again[0]).string, "from entries");
});

test("sendToBoard adds ref cards inside a nested board of this tree, to the right of its content, in the txn", async () => {
  const { fake, session } = setup();
  const res = await session.sendToBoard(["N", "P"], "NB");
  assert.deepEqual(res, { added: 2, title: "Full" });
  assert.equal(creates(fake).length, 2);
  const kids = fake.children("NB");
  assert.equal(kids[0], "nc1");
  assert.equal(kids.at(-1), "NBE", "the Connections block stays last");
  const [a, b] = kids.slice(1, 3);
  assert.deepEqual(strings(fake, [a, b]), ["((N))", "[[Page A]]"]);
  assert.deepEqual(plexus(fake, a), { x: 258, y: 0 });
  assert.deepEqual(plexus(fake, b), { x: 258, y: 184 });
  assert.equal(session.board.items.get("NB").content.length, 4, "the model sees the new children at once");
});

test("sendToBoard writes to a board outside this tree through the host, before its Connections block", async () => {
  const other = (fake) => {
    fake.seedBoard({
      uid: "b2",
      string: "{{[[diagram]]:Elsewhere}}",
      props: { plexus: { v: 2 } },
      children: [card("X", "note x", 50, 60), card("Y", "[[Y page]]", 300, 60), edges("EC2", [])],
    });
    fake.seedBoard({ uid: "b3", props: { plexus: { x: 1 } }, children: [] });
  };
  const { fake, session } = setup(undefined, { extra: other });
  const res = await session.sendToBoard(["P"], "b2");
  assert.deepEqual(res, { added: 1, title: "Elsewhere" });
  assert.equal(creates(fake).length, 1);
  const kids = fake.children("b2");
  assert.equal(kids.length, 4);
  assert.equal(kids.at(-1), "EC2");
  assert.equal(fake.block(kids[2]).string, "[[Page A]]");
  assert.deepEqual(plexus(fake, kids[2]), { x: 548, y: 60 });
  assert.deepEqual(fake.children("b1").length, mainChildren().length, "this board is untouched");
});

test("sendToBoard refuses a missing, non-enhanced, non-board or own target", async () => {
  const other = (fake) => fake.seedBoard({ uid: "b3", props: { plexus: { x: 1 } }, children: [] });
  const { fake, session } = setup(undefined, { extra: other });
  for (const target of ["nope", "b3", "NN", "P", "b1", undefined]) {
    assert.equal(await session.sendToBoard(["N"], target), null, String(target));
  }
  assert.equal(await session.sendToBoard([], "NB"), null);
  assert.equal(await session.sendToBoard(["NB"], "NB"), null, "the target itself is dropped, leaving nothing");
  assert.equal(fake.writesLog().length, 0);
});

test("sendToBoard toasts and resolves null when the outside write fails", async () => {
  const other = (fake) => fake.seedBoard({ uid: "b2", props: { plexus: { v: 2 } }, string: "{{[[diagram]]:E}}", children: [] });
  const { fake, session } = setup(undefined, { extra: other });
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const spy = console.error;
  console.error = () => {};
  fake.failNext = 1;
  const res = await session.sendToBoard(["N"], "b2");
  console.error = spy;
  assert.equal(res, null);
  assert.equal(toasts.length, 1);
});

const outlineBoard = (extra = []) => [
  card("X", "Source note", 100, 100, 280, 160, {}, [
    { uid: "A", string: "branch a", children: [
      { uid: "A1", string: "leaf a1", children: [{ uid: "A1a", string: "deep", children: [{ uid: "tooDeep", string: "depth four" }] }] },
      { uid: "A2", string: "leaf a2" },
    ] },
    { uid: "B", string: "branch b" },
    { uid: "C", string: "branch c" },
  ]),
  ...extra,
];

test("expandOutline lays the note's child blocks out as ref cards with one connection each", async () => {
  const { fake, session } = setup(outlineBoard());
  const res = await session.expandOutline("X");
  assert.deepEqual(res, { added: 6, edges: 6 }, "depth four is left out");
  assert.equal(creates(fake).length, 6 + 6 + 1, "cards, edges and the new Connections block");
  const cards = fake.children("b1").filter((u) => u !== "X" && fake.block(u).string.startsWith("(("));
  const byRef = Object.fromEntries(cards.map((u) => [fake.block(u).string, u]));
  assert.deepEqual(Object.keys(byRef).sort(), ["((A))", "((A1))", "((A1a))", "((A2))", "((B))", "((C))"]);
  const at = (ref) => plexus(fake, byRef[ref]);
  for (const ref of Object.keys(byRef)) {
    assert.equal(at(ref).w, 240);
    assert.equal(at(ref).h, 72);
  }
  assert.equal(at("((A))").x, 460);
  assert.equal(at("((B))").x, 460);
  assert.equal(at("((A1))").x, 780);
  assert.equal(at("((A1a))").x, 1100);
  assert.equal(at("((A2))").x, 780);
  assert.ok(at("((A))").y < at("((B))").y && at("((B))").y < at("((C))").y);
  const center = (at("((A))").y + 36 + at("((C))").y + 36) / 2;
  assert.ok(Math.abs(center - 180) < 0.2, `children centered on the source (${center})`);
  const container = fake.children("b1").at(-1);
  const made = fake.children(container).map((u) => ({ props: plexus(fake, u), string: fake.block(u).string }));
  assert.equal(made.length, 6);
  const fromX = made.filter((e) => e.props.from === "X");
  assert.deepEqual(fromX.map((e) => e.string).sort(), ["((X)) → ((A))", "((X)) → ((B))", "((X)) → ((C))"]);
  assert.deepEqual(fromX.map((e) => e.props.to).sort(), [byRef["((A))"], byRef["((B))"], byRef["((C))"]].sort());
  assert.ok(made.some((e) => e.string === "((A)) → ((A1))" && e.props.from === byRef["((A))"] && e.props.to === byRef["((A1))"]));
  assert.equal(made.every((e) => e.props.type === "edge" && e.props.dir === undefined), true, "direction one is the default and stays implicit");
  assert.equal(fake.block("A").string, "branch a", "the blocks themselves are untouched");
});

test("expandOutline reuses children that already have a card and never moves them", async () => {
  const { fake, session } = setup(outlineBoard([card("Bc", "((B))", 900, 900, 200, 100)]));
  const res = await session.expandOutline("X");
  assert.deepEqual(res, { added: 5, edges: 6 });
  assert.deepEqual(plexus(fake, "Bc"), { x: 900, y: 900, w: 200, h: 100 });
  assert.equal(updates(fake).length, 0);
  const container = fake.children("b1").at(-1);
  const toB = fake.children(container).map((u) => plexus(fake, u)).find((p) => p.to === "Bc");
  assert.equal(toB.from, "X");
  fake.clearLog();
  assert.deepEqual(await session.expandOutline("X"), { added: 0, edges: 0 }, "running it again changes nothing");
  assert.equal(fake.writesLog().length, 0);
});

test("expandOutline lays a reused card's descendants out around where that card really sits", async () => {
  const { fake, session } = setup(outlineBoard([card("A1c", "((A1))", 400, 900, 240, 72)]));
  await session.expandOutline("X");
  assert.deepEqual(plexus(fake, "A1c"), { x: 400, y: 900, w: 240, h: 72 }, "the reused card never moves");
  const cards = fake.children("b1").filter((u) => u !== "X" && u !== "A1c" && fake.block(u).string.startsWith("(("));
  const byRef = Object.fromEntries(cards.map((u) => [fake.block(u).string, u]));
  const deep = plexus(fake, byRef["((A1a))"]);
  const reused = plexus(fake, "A1c");
  assert.equal(deep.x, reused.x + 240 + 80, "A1a sits one column right of A1's real position, not of its slot");
  assert.equal(deep.y, reused.y, "and on the same row (a single child stays level with its parent)");
  assert.notEqual(plexus(fake, byRef["((A))"]).x, reused.x, "A itself is still laid out by the plan");
});

test("expandOutline caps the node count with the shallow levels first", async () => {
  const { fake, session } = setup(outlineBoard());
  const res = await session.expandOutline("X", { max: 2 });
  assert.deepEqual(res, { added: 2, edges: 2, skipped: 4, total: 6 }, "the cap reports how many nodes it left out");
  const strs = fake.children("b1").map((u) => fake.block(u).string);
  assert.ok(strs.includes("((A))") && strs.includes("((B))") && !strs.includes("((C))") && !strs.includes("((A1))"));
});

test("expandOutline honours the direction", async () => {
  const { fake, session } = setup(outlineBoard());
  await session.expandOutline("X", { direction: "down" });
  const cards = fake.children("b1").filter((u) => /^\(\(/.test(fake.block(u).string));
  const ys = cards.map((u) => plexus(fake, u).y);
  assert.ok(ys.every((y) => y >= 100 + 160), "every card sits below the source");
});

const branch = (uid, string, children = []) => ({ uid, string, children });

// 20 descendants. D is a block ref, so "skip block refs" drops D and the two blocks under it.
function outline20() {
  return [
    card("X", "Source note", 100, 100, 280, 160, {}, [
      branch("A", "A", [
        branch("A1", "A1", [branch("A1a", "A1a", [branch("A1ai", "A1ai")])]),
        branch("A2", "A2", [branch("A2a", "A2a")]),
        branch("A3", "A3"),
      ]),
      branch("B", "B", [
        branch("B1", "B1", [branch("B1a", "B1a", [branch("B1ai", "B1ai")])]),
        branch("B2", "B2"),
      ]),
      branch("C", "C", [
        branch("C1", "C1", [branch("C1a", "C1a")]),
        branch("C2", "C2", [branch("C2a", "C2a")]),
      ]),
      branch("D", "((XLE_xhX2y))", [
        branch("D1", "D1"),
        branch("D2", "D2"),
      ]),
    ]),
  ];
}

const refCards = (fake) => fake.children("b1").filter((u) => u !== "X" && /^\(\(/.test(fake.block(u).string));
const byRef = (fake) => Object.fromEntries(refCards(fake).map((u) => [fake.block(u).string, u]));

test("expandOutline runs each preset on a 20-node outline inside one undo group", async () => {
  const base = { depth: 4, spacing: "normal", includeRefs: true, colorBranches: false };
  const placed = async (options) => {
    const { fake, session } = setup(outline20());
    const res = await session.expandOutline("X", options);
    const at = byRef(fake);
    const pos = Object.fromEntries(Object.entries(at).map(([ref, uid]) => [ref, plexus(fake, uid)]));
    return { res, pos, writes: fake.writesLog().length, created: creates(fake).length };
  };
  const right = await placed({ ...base, direction: "right" });
  assert.deepEqual(right.res, { added: 20, edges: 20 });
  assert.equal(right.created, 41, "20 cards, 20 connections, and one Connections block");
  assert.ok(right.writes <= 45, `the expand stays inside one undo group (${right.writes})`);
  assert.equal(Object.keys(right.pos).length, 20);
  assert.ok(right.pos["((A))"].x < right.pos["((A1))"].x && right.pos["((A1))"].x < right.pos["((A1a))"].x);
  assert.equal(right.pos["((A))"].color, undefined);

  const down = await placed({ ...base, direction: "down" });
  assert.equal(down.res.added, 20);
  assert.ok(Object.values(down.pos).every((p) => p.y >= 100 + 160));
  assert.notEqual(down.pos["((A))"].y, right.pos["((A))"].y);

  const balanced = await placed({ ...base, direction: "balanced" });
  assert.equal(balanced.res.added, 20);
  const bx = Object.values(balanced.pos).map((p) => p.x);
  assert.ok(Math.min(...bx) < 100 && Math.max(...bx) > 100, "balanced puts branches on both sides of the source");

  const radial = await placed({ ...base, direction: "radial" });
  assert.equal(radial.res.added, 20);
  const rx = Object.values(radial.pos).map((p) => p.x);
  const ry = Object.values(radial.pos).map((p) => p.y);
  assert.ok(Math.min(...rx) < 100 && Math.max(...ry) > 100 + 160, "radial is not a single row or column");
  assert.notEqual(radial.pos["((B))"].x, right.pos["((B))"].x);

  const compact = await placed({ ...base, direction: "right", spacing: "compact" });
  const airy = await placed({ ...base, direction: "right", spacing: "airy" });
  const gap = (pos) => pos["((A1))"].x - pos["((A))"].x;
  assert.ok(gap(compact.pos) < gap(right.pos) && gap(right.pos) < gap(airy.pos));

  const depth1 = await placed({ ...base, direction: "right", depth: 1 });
  assert.deepEqual(depth1.res, { added: 4, edges: 4 });
  const depth2 = await placed({ ...base, direction: "right", depth: 2 });
  assert.equal(depth2.res.added, 13);
  const depth3 = await placed({ ...base, direction: "right", depth: 3 });
  assert.equal(depth3.res.added, 18);

  const skipped = await placed({ ...base, direction: "right", includeRefs: false });
  assert.equal(skipped.res.added, 17);
  assert.equal(skipped.pos["((D))"], undefined);
  assert.equal(skipped.pos["((D1))"], undefined);
  assert.ok(skipped.pos["((A))"]);

  const colored = await placed({ ...base, direction: "right", colorBranches: true });
  assert.equal(colored.res.added, 20);
  assert.equal(colored.pos["((A))"].color, colored.pos["((A1))"].color);
  assert.equal(colored.pos["((A1))"].color, colored.pos["((A1ai))"].color);
  assert.notEqual(colored.pos["((A))"].color, colored.pos["((B))"].color);
  assert.notEqual(colored.pos["((B))"].color, colored.pos["((C))"].color);
  assert.notEqual(colored.pos["((C))"].color, colored.pos["((D))"].color);
  assert.equal(colored.pos["((D))"].color, colored.pos["((D1))"].color);
  assert.equal(colored.writes <= 45, true, "branch color rides on the create, not a second write");
});

test("expandOutline depth 4 includes the node the default depth leaves out", async () => {
  const { fake, session } = setup(outlineBoard());
  const res = await session.expandOutline("X", { depth: 4 });
  assert.deepEqual(res, { added: 7, edges: 7 });
  const strs = fake.children("b1").map((u) => fake.block(u).string);
  assert.ok(strs.includes("((tooDeep))"));
});

test("expandOutline reads the tree of a block card and of a page card from the graph", async () => {
  const seed = (fake) => {
    fake.seedPage({ title: "Src page", uid: "srcPage", children: [
      { uid: "pr1", string: "page block one", children: [{ uid: "pr1a", string: "nested" }] },
      { uid: "pr2", string: "page block two" },
    ] });
    fake.seedPage({ title: "Other", uid: "otherPage", children: [
      { uid: "R", string: "root block", children: [{ uid: "r1", string: "child one" }, { uid: "r2", string: "child two" }] },
    ] });
  };
  const { fake, session } = setup([
    card("blk", "((R))", 0, 0, 280, 160),
    card("pg", "[[Src page]]", 0, 400, 280, 160),
    card("txt", "plain text", 0, 800, 240, 48, { type: "text" }),
    section("sec", 0, 1000, 300, 200),
  ], { extra: seed });
  assert.deepEqual(await session.expandOutline("blk"), { added: 2, edges: 2 });
  assert.deepEqual(await session.expandOutline("pg"), { added: 3, edges: 3 });
  const strs = fake.children("b1").map((u) => fake.block(u).string);
  assert.ok(["((r1))", "((r2))", "((pr1))", "((pr1a))", "((pr2))"].every((s) => strs.includes(s)));
  const container = fake.children("b1").at(-1);
  assert.ok(fake.children(container).some((u) => fake.block(u).string === "((R)) → ((r1))"));
  assert.ok(fake.children(container).some((u) => fake.block(u).string === "[[Src page]] → ((pr1))"));
  assert.deepEqual(await session.expandOutline("txt"), { added: 0, edges: 0 });
  assert.deepEqual(await session.expandOutline("sec"), { added: 0, edges: 0 });
  assert.deepEqual(await session.expandOutline("ghost"), { added: 0, edges: 0 });
});

test("expandOutline on a note without children writes nothing", async () => {
  const { fake, session } = setup([card("lonely", "no kids", 0, 0)]);
  assert.deepEqual(await session.expandOutline("lonely"), { added: 0, edges: 0 });
  assert.equal(fake.writesLog().length, 0);
});

test("session.undo after a clip leaves the model consistent with the graph", async () => {
  const { fake, session } = setup();
  await session.duplicateItems(["N", "S"]);
  await fake.flush();
  await session.undo();
  await fake.flush();
  assert.equal(fake.calls.some((c) => c[0] === "undo"), true);
  const persisted = buildBoard(session.host.pullBoard("b1"));
  assert.deepEqual([...session.board.items.keys()].sort(), [...persisted.items.keys()].sort());
  assert.deepEqual([...session.board.edges.keys()].sort(), [...persisted.edges.keys()].sort());
  assert.equal(session.rects.size, persisted.items.size);
  for (const e of session.board.edges.values()) assert.equal(e.valid, true, "no dangling connection after the clone");
});

test("created blocks are echoed without flicker: the model stays equal to the graph after the echoes land", async () => {
  const { fake, session } = setup();
  await session.pasteText("one\ntwo", { x: 3000, y: 0 });
  await session.duplicateItems(["S"]);
  await fake.flush();
  const persisted = buildBoard(session.host.pullBoard("b1"));
  assert.deepEqual([...session.board.items.keys()], [...persisted.items.keys()]);
  assert.equal(session.board.items.size, persisted.items.size);
});
