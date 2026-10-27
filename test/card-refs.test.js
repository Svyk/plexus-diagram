import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CARD_REFS_MAX, cardRefLinks, cardRefsOn, mergeLinks, treeLinks } from "../src/model/card-refs.js";
import { reduceLinks } from "../src/model/links.js";
import { colorForLabel } from "../src/model/schema.js";
import { treeItems } from "../src/host/follow-sources.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { FOLLOW_KEY } from "../src/model/follow.js";
import { LOCAL_EDIT_MS, PIN_BATCH, acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const row = (uid, string, kids = []) => ({ ":block/uid": uid, ":block/string": string, ":block/children": kids });
const page = (uid, title, content = []) => ({ uid, type: "card", kind: "page", string: `[[${title}]]`, target: { kind: "page", title }, content });
const block = (uid, ref, content = []) => ({ uid, type: "card", kind: "block", string: `((${ref}))`, target: { kind: "block", uid: ref }, content });
const note = (uid, string, content = []) => ({ uid, type: "card", kind: "note", string, target: { kind: "self", uid }, content });
const boardOf = (...items) => ({ items: new Map(items.map((i) => [i.uid, i])), plexus: { v: 2 } });
const find = (links, from, to) => links.find((l) => l.from === from && l.to === to);

test("a note card's own text links to the page card it mentions", () => {
  const links = cardRefLinks(boardOf(note("n1", "see [[B]] today"), page("pB", "B")));
  assert.equal(links.length, 1);
  assert.deepEqual(links[0], {
    key: "n1->pB", from: "n1", to: "pB", kind: "ref", labels: ["mentions"],
    sources: [{ uid: "n1", string: "see [[B]] today" }], color: "gray",
  });
});

test("a ((uid)) in a child row of a card links to the block card", () => {
  const links = cardRefLinks(boardOf(page("pA", "A", [row("r1", "x", [row("r2", "deep ((blk000001))")])]), block("bB", "blk000001")));
  const l = find(links, "pA", "bB");
  assert.ok(l);
  assert.deepEqual(l.sources, [{ uid: "r2", string: "deep ((blk000001))" }]);
});

test("#tag and #[[Two words]] link to page cards", () => {
  const links = cardRefLinks(boardOf(note("n1", "todo #ops and #[[Two words]]"), page("p1", "ops"), page("p2", "Two words")));
  assert.ok(find(links, "n1", "p1"));
  assert.ok(find(links, "n1", "p2"));
});

test("an attribute row labels the link, a bare parent attribute labels its child", () => {
  const links = cardRefLinks(boardOf(
    page("pA", "A", [row("r1", "Owner:: [[B]]"), row("r2", "Depends on::", [row("r3", "[[C]]")]), row("r4", "also [[B]]")]),
    page("pB", "B"),
    page("pC", "C"),
  ));
  const ab = find(links, "pA", "pB");
  assert.equal(ab.kind, "attr");
  assert.deepEqual(ab.labels, ["Owner", "mentions"]);
  assert.equal(ab.color, colorForLabel("Owner"));
  const ac = find(links, "pA", "pC");
  assert.equal(ac.kind, "attr");
  assert.deepEqual(ac.labels, ["Depends on"]);
});

test("a self-ref is dropped, and a page or block card's own string is not a source", () => {
  const links = cardRefLinks(boardOf(note("n1", "I am [[B]] and ((n1))"), page("pB", "B"), block("bX", "blk000001"), page("pC", "C")));
  assert.deepEqual(links.map((l) => l.key), ["n1->pB"]);
  // [[C]] is the card's own string, ((blk000001)) too: neither makes a link.
  assert.equal(cardRefLinks(boardOf(page("pB", "B"), page("pC", "C", []))).length, 0);
  assert.equal(cardRefLinks(boardOf(page("pB", "[[C]]"), page("pC", "C"))).length, 0);
});

test("one target shared by two cards gives two links", () => {
  const links = cardRefLinks(boardOf(note("n1", "[[B]]"), page("pB1", "B"), block("bB2", "blk000001")));
  assert.equal(links.length, 1);
  const two = cardRefLinks(boardOf(note("n1", "[[B]]"), page("pB1", "B"), { ...page("pB2", "B") }));
  assert.deepEqual(two.map((l) => l.key).sort(), ["n1->pB1", "n1->pB2"]);
});

test("a page card's uid also matches ((uid)) and inline code is skipped", () => {
  const withUid = { ...page("pB", "B"), target: { kind: "page", title: "B", uid: "pageuid01" } };
  assert.ok(find(cardRefLinks(boardOf(note("n1", "see ((pageuid01))"), withUid)), "n1", "pB"));
  assert.equal(cardRefLinks(boardOf(note("n1", "code `[[B]]`"), page("pB", "B"))).length, 0);
});

test("sources stay at 20 and depth is bounded", () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, `see [[B]] ${i}`));
  const [l] = cardRefLinks(boardOf(page("pA", "A", rows), page("pB", "B")));
  assert.equal(l.sources.length, 20);
  let deep = row("d9", "[[B]]");
  for (let i = 8; i >= 1; i -= 1) deep = row(`d${i}`, "x", [deep]);
  assert.equal(cardRefLinks(boardOf(page("pA", "A", [deep]), page("pB", "B"))).length, 0, "the ninth level is not read");
});

test("cardRefsOn: 401 items is off whatever the key says, 10 items is on by default, refs:false is off", () => {
  const sized = (n, plexus) => ({ items: new Map(Array.from({ length: n }, (_, i) => [`i${i}`, { uid: `i${i}` }])), plexus });
  assert.equal(CARD_REFS_MAX, 400);
  assert.equal(cardRefsOn(sized(CARD_REFS_MAX + 1, { v: 2, refs: true })), false);
  assert.equal(cardRefsOn(sized(CARD_REFS_MAX, { v: 2 })), true);
  assert.equal(cardRefsOn(sized(10, { v: 2 })), true);
  assert.equal(cardRefsOn(sized(10, null)), true);
  assert.equal(cardRefsOn(sized(10, { v: 2, refs: false })), false);
});

test("mergeLinks unions by key: attr beats ref, labels and sources merge, query-link shape is kept", () => {
  const eidToItems = new Map([[1, ["pA"]], [2, ["pB"]]]);
  const queried = reduceLinks([[1, 2, "s1", "plain [[B]]"]], { eidToItems });
  const local = cardRefLinks(boardOf(page("pA", "A", [row("r1", "Owner:: [[B]]")]), page("pB", "B"), page("pC", "C", [row("r2", "[[A]]")])));
  const merged = mergeLinks(queried, local);
  assert.equal(merged.length, 2);
  const ab = find(merged, "pA", "pB");
  assert.equal(ab.kind, "attr");
  assert.deepEqual(ab.labels, ["Owner", "mentions"]);
  assert.deepEqual(ab.sources.map((s) => s.uid), ["s1", "r1"]);
  assert.equal(ab.color, colorForLabel("Owner"));
  assert.equal(queried[0].kind, "ref", "inputs are not mutated");
  assert.deepEqual(mergeLinks(undefined, null), []);
});

test("treeLinks: a parent card links to its child card; tree stays only when it is the only kind", () => {
  const key = "block:SRC000001";
  const child = { ...block("cC", "blkChild01"), src: key };
  const board = boardOf(block("cP", "blkParent1"), child, { ...block("cX", "blkOther01"), src: "block:other" });
  const parents = new Map([["blkChild01", "blkParent1"], ["blkOther01", "blkParent1"]]);
  const tree = treeLinks(board, parents, key);
  assert.deepEqual(tree, [{ key: "cP->cC", from: "cP", to: "cC", kind: "tree", labels: [], sources: [], color: "gray" }]);
  assert.deepEqual(treeLinks(board, new Map([["blkChild01", "SRC000001"]]), key), [], "a level-1 child's parent is the source root: no card");
  const merged = mergeLinks(tree, [{ key: "cP->cC", from: "cP", to: "cC", kind: "ref", labels: ["mentions"], sources: [], color: "gray" }]);
  assert.equal(merged[0].kind, "ref");
  assert.equal(mergeLinks(tree, tree)[0].kind, "tree");
});

test("treeItems emits the parent: the root uid for level 1, the enclosing block below", () => {
  const n = (uid, string, kids = []) => ({ ":block/uid": uid, ":block/string": string, ":edit/time": 1, ":block/children": kids.map((k, i) => ({ ...k, ":block/order": i })) });
  const { items } = treeItems(n("SRC000001", "Source", [n("k1", "one", [n("g1", "grand")]), n("k2", "two")]), { depth: 2 });
  assert.deepEqual(items.map((i) => `${i.uid}<${i.parent}`), ["k1<SRC000001", "g1<k1", "k2<SRC000001"]);
});

// ---- session
function setup(count = 3, extra = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const cards = Array.from({ length: count }, (_, i) => ({ uid: `pg${String(i).padStart(7, "0")}`, string: `[[P${i}]]`, props: { plexus: { x: i * 300, y: 0, w: 280, h: 160 } } }));
  const mention = Array.from({ length: count }, (_, i) => `[[P${i}]]`).join(" ");
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 }, plexus: { v: 2, ...extra } },
    children: [...cards, { uid: "note00001", string: `see ${mention}`, props: { plexus: { x: 0, y: 400, w: 280, h: 160 } } }],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  return { fake, host, session, cards };
}

test("opening and rebuilding a board with ref arrows writes nothing", async () => {
  const { fake, host, session } = setup(3);
  await session.linksPromise;
  assert.equal(session.links.filter((l) => l.from === "note00001").length, 3);
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
  assert.deepEqual(session.cardRefs, { on: true, big: false });
});

test("setCardRefs(false) is one props write and the arrows go; refs:false in the board is honoured on open", async () => {
  const { fake, session } = setup(3);
  await session.linksPromise;
  fake.clearLog();
  assert.equal(await session.setCardRefs(false), true);
  assert.equal(fake.writesLog().length, 1);
  assert.equal(session.links.length, 0);
  assert.deepEqual(session.cardRefs, { on: false, big: false });
  resetSessions();
  const off = setup(3, { refs: false });
  await off.session.linksPromise;
  assert.equal(off.session.links.length, 0);
});

test("pinLinks is one capped batch: container once, PIN_BATCH edges, covered links skipped", async () => {
  const { fake, host, session } = setup(25);
  await session.linksPromise;
  const mine = session.links.filter((l) => l.from === "note00001");
  assert.equal(mine.length, 25);
  fake.clearLog();
  const made = await session.pinLinks(mine);
  assert.equal(made.length, PIN_BATCH);
  const writes = fake.writesLog().length;
  assert.ok(writes <= 45, `one undo step, got ${writes} writes`);
  assert.equal(host.stats.lastAction.writes, writes, "a single group");
  assert.equal(session.board.edges.size, PIN_BATCH);
  assert.ok(PIN_BATCH <= 20);
  const again = await session.pinLinks(session.links.filter((l) => l.from === "note00001"));
  assert.equal(again.length, 5, "the 20 pinned links are covered and skipped");
  assert.equal(session.board.edges.size, 25);
  assert.deepEqual(await session.pinLinks([]), []);
});

// The watch flush runs on the session's own frame: wait for the edit to land, not a fixed time.
async function settled(fake, done) {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await fake.flush();
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(done(), "the edit reached the board");
}

// In-place typing keeps the board object: the arrows must still follow the text, and a pin must not write a target
// the text dropped.
test("editing a card in place moves its arrow; a pin of the old arrow writes nothing", async () => {
  const { fake, host, session, cards } = setup(2);
  await fake.flush();
  await session.linksPromise;
  const old = session.links.find((l) => l.key === `note00001->${cards[0].uid}`);
  assert.ok(old);
  session.setEditing("note00001");
  const before = session.board;
  await fake.api.data.block.update({ block: { uid: "note00001", string: "see [[P1]] today" } });
  await settled(fake, () => session.board.items.get("note00001").string === "see [[P1]] today");
  assert.equal(session.board, before, "the typing flush patched the same board object");
  assert.equal(session.board.items.get("note00001").string, "see [[P1]] today");
  const writes = host.stats.writes;
  assert.equal(await session.pinLink(old), null, "the stale arrow is not pinned, even before editing ends");
  assert.equal(host.stats.writes, writes);
  assert.deepEqual(session.links.filter((l) => l.from === "note00001").map((l) => l.to), [cards[1].uid]);
  session.setEditing(null);
  assert.equal(session.links.some((l) => l.key === old.key), false);
  assert.deepEqual(await session.pinLinks([old]), []);
  assert.equal(session.board.edges.size, 0);
  const uid = await session.pinLink(session.links.find((l) => l.key === `note00001->${cards[1].uid}`));
  assert.equal(session.board.edges.get(uid)?.to, cards[1].uid);
});

test("the arrows follow typing a short pause later, with no pin and no editing end", async () => {
  const { fake, session, cards } = setup(2);
  await fake.flush();
  await session.linksPromise;
  session.setEditing("note00001");
  await fake.api.data.block.update({ block: { uid: "note00001", string: "only [[P1]]" } });
  await settled(fake, () => session.board.items.get("note00001").string === "only [[P1]]");
  await new Promise((r) => setTimeout(r, LOCAL_EDIT_MS + 50));
  assert.deepEqual(session.links.filter((l) => l.from === "note00001").map((l) => l.to), [cards[1].uid]);
});

test("setFollowParents is ignored when the board does not follow a tree", async () => {
  const { fake, session } = setup(2);
  await session.linksPromise;
  session.setFollowParents(new Map([["a", "b"]]));
  assert.equal(fake.writesLog().length, 0);
});

test("setFollowParents on a tree board draws a dotted parent -> child link, and writes nothing", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const key = "block:SRC000001";
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2, [FOLLOW_KEY]: { kind: "block", uid: "SRC000001", tree: true } } },
    children: [
      { uid: "cP000001", string: "((blkParent1))", props: { plexus: { x: 0, y: 0, w: 280, h: 160, src: key } } },
      { uid: "cC000001", string: "((blkChild01))", props: { plexus: { x: 400, y: 0, w: 280, h: 160, src: key } } },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  await session.linksPromise;
  session.setFollowParents(new Map([["blkChild01", "blkParent1"]]));
  const l = session.links.find((x) => x.key === "cP000001->cC000001");
  assert.equal(l?.kind, "tree");
  assert.equal(host.stats.writes, 0);
  const uid = await session.pinLink(l);
  assert.equal(session.board.edges.get(uid).label, "", "a tree link pins with no label");
});
