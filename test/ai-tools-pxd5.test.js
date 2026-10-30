import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createAiTools, installAiTools } from "../src/model/ai-tools.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { boardToMarkdown } from "../src/model/export.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
afterEach(() => resetSessions());

function seed(fake) {
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 }, plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 400, y: 0, w: 280, h: 160 } } },
      {
        uid: "s1",
        string: "Group",
        props: { plexus: { type: "section", x: 0, y: 300, w: 500, h: 300 } },
        children: [{ uid: "c3", string: "[[C]]", props: { plexus: { x: 20, y: 60, w: 280, h: 160 } } }],
      },
    ],
  });
  fake.seedBlock?.({ uid: "plain", string: "not a board" });
}

// Records the payload of every write the host makes.
function recorder(fake) {
  const seen = [];
  for (const [ns, fns] of [["block", ["create", "update", "move", "delete"]], ["page", ["create"]]]) {
    for (const fn of fns) {
      const orig = fake.api.data[ns][fn];
      fake.api.data[ns][fn] = (arg) => { seen.push({ ns, fn, arg: structuredClone(arg) }); return orig(arg); };
    }
  }
  return seen;
}

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seed(fake);
  const seen = recorder(fake);
  const calls = { sessions: 0, wrapped: [] };
  const tools = createAiTools({
    listBoards: () => [
      { uid: "b1", title: "Main", pageTitle: "Lab Notes", pageUid: "p1", count: 4, edited: 1 },
      { uid: "b2", title: "Other", pageTitle: "Zed", pageUid: "p2", count: 1, edited: 2 },
    ],
    pullBoard: (uid) => host.pullBoard(uid),
    withSession: async (uid, fn) => {
      calls.sessions++;
      const session = acquireSession(uid, { host, linkDelay: 0 });
      try { return await fn(session); } finally { session.release(); }
    },
  });
  const tool = (name) => tools.find((t) => t.name === name);
  return { fake, host, seen, tools, tool, calls };
}

const ctx = (extra = {}) => ({
  tokenUserUid: "ai-user",
  asTokenUser: (fn) => { assert.equal(typeof fn, "function"); const r = fn(); assert.ok(!r?.then || true); return r; },
  ...extra,
});

test("host writes carry user-uid only when a user is given", async () => {
  const { host, seen } = setup();
  await host.createBlock({ parentUid: "b1", uid: "n1", string: "x", user: "u1" });
  await host.createBlock({ parentUid: "b1", uid: "n2", string: "y" });
  await host.updateProps("n1", { x: 1 }, "u1");
  await host.updateProps("n2", { x: 1 });
  await host.moveBlock("n1", "b1", "last", "u1");
  await host.moveBlock("n2", "b1", "last");
  await host.updateString("n1", "z", "u1");
  await host.setOpen("n1", false, "u1");
  await host.deleteBlock("n1", "u1");
  await host.deleteBlock("n2");
  await host.createPage({ uid: "pg1", title: "Page One", user: "u1" });
  await host.createPage({ uid: "pg2", title: "Page Two" });
  const has = (e) => Object.hasOwn(e.arg.block ?? e.arg.page, "user-uid");
  const withUser = seen.filter(has);
  const without = seen.filter((e) => !has(e));
  assert.equal(withUser.length, 7);
  assert.ok(withUser.every((e) => (e.arg.block ?? e.arg.page)["user-uid"] === "u1"));
  assert.equal(without.length, 5);
});

test("session.asUser stamps its transaction, restores after, and nests", async () => {
  const { host, seen } = setup();
  const session = acquireSession("b1", { host, linkDelay: 0 });
  seen.length = 0;
  let inner;
  const p1 = session.asUser("ai-1", () => {
    const a = session.addRefCards([{ string: "[[X]]", x: 0, y: 900 }]);
    inner = session.asUser("ai-2", () => session.addRefCards([{ string: "[[Y]]", x: 400, y: 900 }]));
    const b = session.addRefCards([{ string: "[[Z]]", x: 800, y: 900 }]);
    return Promise.all([a, b]);
  });
  const p2 = session.asUser("", () => session.addRefCards([{ string: "[[Q]]", x: 0, y: 1200 }]));
  const p3 = session.addRefCards([{ string: "[[R]]", x: 400, y: 1200 }]);
  await Promise.all([p1, inner, p2, p3]);
  const byString = (s) => seen.find((e) => e.fn === "create" && e.arg.block.string === s).arg.block;
  assert.equal(byString("[[X]]")["user-uid"], "ai-1");
  assert.equal(byString("[[Y]]")["user-uid"], "ai-2");
  assert.equal(byString("[[Z]]")["user-uid"], "ai-1");
  assert.equal(Object.hasOwn(byString("[[Q]]"), "user-uid"), false);
  assert.equal(Object.hasOwn(byString("[[R]]"), "user-uid"), false);
  session.release();
});

test("list_boards filters by page and reports shapes", () => {
  const { tool } = setup();
  const all = tool("list_boards").handler({});
  assert.equal(all.count, 2);
  assert.deepEqual(all.boards[0], { uid: "b1", title: "Main", page: "Lab Notes", pageUid: "p1", cards: 4 });
  const some = tool("list_boards").handler({ page: "lab" });
  assert.equal(some.boards.length, 1);
  assert.equal(some.truncated, false);
});

test("read_board returns the markdown, sections, cards and arrows", async () => {
  const { host, tool } = setup();
  const session = acquireSession("b1", { host, linkDelay: 0 });
  await session.addEdge({ from: "c1", to: "c2", label: "next", dir: "one" });
  await sleep(0);
  session.release();
  const out = tool("read_board").handler({ board: "((b1))" });
  const board = buildBoard(host.pullBoard("b1"));
  assert.equal(out.text, boardToMarkdown(board, worldRects(board)));
  assert.deepEqual(out.sections.map((s) => s.uid), ["s1"]);
  assert.equal(out.sections[0].parent, null);
  const c3 = out.cards.find((c) => c.uid === "c3");
  assert.equal(c3.section, "s1");
  assert.deepEqual(c3.rect, { x: 20, y: 360, w: 280, h: 160 });
  assert.equal(out.arrows.length, 1);
  assert.equal(out.arrows[0].from, "c1");
  assert.equal(out.arrows[0].direction, "one");
});

test("non-Plexus and empty board uids throw", async () => {
  const { tool } = setup();
  assert.throws(() => tool("read_board").handler({ board: "" }), /Give a board uid/);
  assert.throws(() => tool("read_board").handler({ board: "plain" }), /Not a Plexus board/);
  await assert.rejects(tool("add_cards").handler({ board: "plain", cards: [{ text: "x" }] }, ctx()), /Not a Plexus board/);
});

test("add_cards auto-places, attributes the AI, and is one transaction", async () => {
  const { host, tool, seen, calls } = setup();
  const out = await tool("add_cards").handler({ board: "b1", cards: [{ text: "[[N1]]" }, { text: "note two" }, { text: "pinned", x: 2000, y: 2000 }] }, ctx());
  assert.equal(out.count, 3);
  assert.equal(calls.sessions, 1);
  const board = buildBoard(host.pullBoard("b1"));
  const rects = worldRects(board);
  const r1 = rects.get(out.added[0]);
  const r2 = rects.get(out.added[1]);
  assert.equal(r1.x, 0);
  assert.equal(r1.y, 680); // below the lowest bottom (section ends at 600) plus 80
  assert.equal(r2.x, 320);
  assert.equal(rects.get(out.added[2]).x, 2000);
  const created = seen.filter((e) => e.fn === "create");
  assert.equal(created.length, 3);
  assert.ok(created.every((e) => e.arg.block["user-uid"] === "ai-user"));
});

test("add_cards places inside a section and validates it", async () => {
  const { host, tool } = setup();
  const out = await tool("add_cards").handler({ board: "b1", section: "s1", cards: [{ text: "[[In]]" }] }, ctx());
  const board = buildBoard(host.pullBoard("b1"));
  assert.equal(board.items.get(out.added[0]).parentUid, "s1");
  await assert.rejects(tool("add_cards").handler({ board: "b1", section: "c1", cards: [{ text: "x" }] }, ctx()), /Not a section/);
});

test("add_cards refuses 46 cards", async () => {
  const { tool } = setup();
  const cards = Array.from({ length: 46 }, (_, i) => ({ text: `n${i}` }));
  await assert.rejects(tool("add_cards").handler({ board: "b1", cards }, ctx()), /At most 45 cards per call/);
});

test("add_section, connect_cards and arrange_board", async () => {
  const { host, tool, seen } = setup();
  const sec = await tool("add_section").handler({ board: "b1", title: "New" }, ctx());
  const board1 = buildBoard(host.pullBoard("b1"));
  assert.equal(board1.items.get(sec.uid).type, "section");
  assert.equal(board1.items.get(sec.uid).w, 640);
  assert.equal(board1.items.get(sec.uid).h, 400);
  const edge = await tool("connect_cards").handler({ board: "b1", from: "c1", to: "c2", label: "why" }, ctx());
  assert.ok(edge.uid);
  await assert.rejects(tool("connect_cards").handler({ board: "b1", from: "c1", to: "nope" }, ctx()), /nope/);
  seen.length = 0;
  const arranged = await tool("arrange_board").handler({ board: "b1", mode: "row", cards: ["c1", "c2"] }, ctx());
  assert.equal(arranged.moved, 2);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((e) => e.arg.block["user-uid"] === "ai-user"));
  const board2 = buildBoard(host.pullBoard("b1"));
  assert.equal(board2.items.get("c1").y, board2.items.get("c2").y);
});

test("asTokenUser receives a synchronous function and the write is awaited outside it", async () => {
  const { tool } = setup();
  let seenFn = null;
  let returned;
  const context = { tokenUserUid: "ai-user", asTokenUser: (fn) => { seenFn = fn; returned = fn(); return returned; } };
  const out = await tool("add_section").handler({ board: "b1", title: "T" }, context);
  assert.equal(typeof seenFn, "function");
  assert.equal(seenFn.constructor.name, "Function");
  assert.ok(out.uid);
});

test("every tool schema fits Roam's limits", () => {
  const { tools } = setup();
  assert.deepEqual(tools.map((t) => t.name), ["list_boards", "read_board", "add_cards", "add_section", "connect_cards", "arrange_board"]);
  for (const t of tools) {
    assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(t.description.length <= 2000);
    assert.ok(JSON.stringify(t.inputSchema).length <= 4000);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(["read", "append", "edit"].includes(t.scope));
    for (const [k, p] of Object.entries(t.inputSchema.properties)) assert.ok(p.description, `${t.name}.${k}`);
  }
});

test("installAiTools: no ai api, one throwing tool, and dispose", () => {
  const tools = [{ name: "a" }, { name: "b" }, { name: "c" }];
  assert.doesNotThrow(() => installAiTools({}, tools)());
  assert.doesNotThrow(() => installAiTools(null, tools)());
  const added = [];
  const removed = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const dispose = installAiTools({ ai: {
      addTool: (t) => { if (t.name === "b") throw new Error("bad"); added.push(t.name); },
      removeTool: ({ name }) => { removed.push(name); if (name === "a") throw new Error("x"); },
    } }, tools);
    assert.deepEqual(added, ["a", "c"]);
    dispose();
  } finally { console.warn = warn; }
  assert.deepEqual(removed, ["a", "c"]);
});
