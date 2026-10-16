// Lane H: one Cmd+Z after a big drag must restore every card. Entry points are session.commitMove
// (board-view.js and interactions.js pass the drag through) and session.undo (the undo key).
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { bigBoardTree } from "../src/model/stress-board.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

// Pull trees carry :plexus props with colon keys; the fake Roam seeds plain ones.
const toSeed = (n) => ({
  uid: n[":block/uid"],
  string: n[":block/string"],
  props: n[":block/props"] ? { plexus: n[":block/props"].plexus } : undefined,
  heading: n[":block/heading"],
  open: n[":block/open"],
  children: (n[":block/children"] || []).map(toSeed),
});

// 1,536 section cards + 24 nested boards = 1,560 non-section items. No notes, edges, or inner cards,
// so the tree stays under the split-watch line and each echo is a full pull.
const FIXTURE = { cards: 1536, sections: 46, edges: 0, nested: 24, nestedCards: 0, nestedKids: 0, kids: 0 };

function open(extra = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.trackUndo = true;
  const seed = toSeed(bigBoardTree(FIXTURE));
  fake.seedBoard({ uid: seed.uid, string: seed.string, props: seed.props, children: seed.children });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g", ...extra.host });
  const session = acquireSession("bigroot", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
    ...extra.session,
  });
  return { fake, host, session, restore };
}

function cardIds(session) {
  return [...session.board.items.values()].filter((it) => it.type !== "section").map((it) => it.uid);
}

function sectionIds(session) {
  return [...session.board.items.values()].filter((it) => it.type === "section").map((it) => it.uid);
}

function snap(fake, ids) {
  const out = new Map();
  for (const id of ids) {
    const block = fake.block(id);
    out.set(id, { parent: block.parent, order: block.order, plexus: block.props?.plexus ?? null });
  }
  return out;
}

function same(a, b) {
  return a.parent === b.parent && a.order === b.order && JSON.stringify(a.plexus) === JSON.stringify(b.plexus);
}

function differCount(before, after) {
  let n = 0;
  for (const [id, prev] of before) if (!same(prev, after.get(id))) n += 1;
  return n;
}

// Rightmost column (c % 5 === 4) center sits at world x 1044. dx=400 lands it in the next section
// (starts at 1280). The column to its left stays inside (center 1224, section ends at 1240 inclusive).
function pickCrossing(session) {
  const picked = [];
  const parents = new Set();
  for (let s = 0; s <= 4 && picked.length < 150; s += 1) {
    const sec = session.board.items.get(`bs${s}`);
    for (const id of sec.members) {
      picked.push(id);
      parents.add(sec.uid);
      if (picked.length === 150) break;
    }
  }
  return { picked, parents };
}

test("one undo after 150 cards cross section boundaries restores all 1,560", async () => {
  const { fake, session, restore } = open();
  try {
    const ids = cardIds(session);
    assert.equal(ids.length, 1560);
    const { picked, parents } = pickCrossing(session);
    assert.equal(picked.length, 150);
    assert.ok(parents.size >= 3, `selection spans ${parents.size} sections`);
    const before = snap(fake, ids);
    const sectionsBefore = snap(fake, sectionIds(session));
    await session.commitMove(picked, 400, 0);
    await fake.flush();
    const after = snap(fake, ids);
    const crossed = ids.filter((id) => before.get(id).parent !== after.get(id).parent);
    assert.ok(crossed.length >= 20, `drag crossed ${crossed.length} cards; the fixture geometry should reparent the rightmost column`);
    fake.calls.length = 0;
    await session.undo();
    await fake.flush();
    const restored = snap(fake, ids);
    const left = differCount(before, restored);
    assert.equal(left, 0, `one Cmd+Z left ${left} of ${ids.length} cards different from the pre-drag layout`);
    assert.equal(differCount(sectionsBefore, snap(fake, sectionIds(session))), 0, "section frames are part of the same undo");
    const native = fake.calls.filter((c) => c[0] === "undo").length;
    assert.equal(native, 0, `one Cmd+Z is one custom entry, not ${native} native undos`);
  } finally {
    restore();
  }
});

test("undo writes the inverse: move back to the original parent and order, then the original props", async () => {
  const { fake, session, restore } = open();
  try {
    const ids = cardIds(session);
    const sections = sectionIds(session);
    const watched = [...ids, ...sections];
    const { picked } = pickCrossing(session);
    const before = snap(fake, watched);
    await session.commitMove(picked, 400, 0);
    await fake.flush();
    const after = snap(fake, watched);
    fake.clearLog();
    await session.undo();
    await fake.flush();
    const log = fake.writesLog();
    const moves = [];
    const props = [];
    for (const [id, prev] of before) {
      const now = after.get(id);
      if (now.parent !== prev.parent) moves.push({ uid: id, parent: prev.parent, order: prev.order });
      if (JSON.stringify(now.plexus) !== JSON.stringify(prev.plexus)) props.push({ uid: id, plexus: prev.plexus });
    }
    moves.sort((a, b) => (a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : a.order - b.order));
    const loggedMoves = log.filter((e) => e[0] === "move").map((e) => ({ uid: e[1], parent: e[2], order: e[3] }));
    const loggedProps = log.filter((e) => e[0] === "update");
    assert.deepEqual(loggedMoves, moves, "Roam gets one move back per reparented block, low original order first");
    assert.equal(loggedProps.length, props.length, `props writes ${loggedProps.length}, expected ${props.length}`);
    const propByUid = new Map(props.map((p) => [p.uid, p.plexus]));
    const seen = new Set();
    for (const entry of loggedProps) {
      const uid = entry[1];
      seen.add(uid);
      assert.deepEqual(entry[2]?.props?.plexus, propByUid.get(uid), `props inverse for ${uid}`);
    }
    assert.deepEqual([...seen].sort(), [...propByUid.keys()].sort());
    const other = log.filter((e) => e[0] !== "move" && e[0] !== "update");
    assert.deepEqual(other, [], "undo writes no creates or deletes");
    for (const move of moves) {
      const at = log.findIndex((e) => e[0] === "move" && e[1] === move.uid);
      const propAt = log.findIndex((e) => e[0] === "update" && e[1] === move.uid);
      if (propAt >= 0) assert.ok(at >= 0 && at < propAt, `${move.uid} moves back before its props write`);
    }
  } finally {
    restore();
  }
});

test("redo restores the dragged layout and a second undo returns to the pre-drag layout", async () => {
  const { fake, session, restore } = open();
  try {
    const ids = cardIds(session);
    const sections = sectionIds(session);
    const { picked } = pickCrossing(session);
    const before = snap(fake, ids);
    const sectionsBefore = snap(fake, sections);
    await session.commitMove(picked, 400, 0);
    await fake.flush();
    const after = snap(fake, ids);
    const sectionsAfter = snap(fake, sections);
    await session.undo();
    await fake.flush();
    await session.redo();
    await fake.flush();
    assert.equal(differCount(after, snap(fake, ids)), 0, "redo puts the dragged cards back");
    assert.equal(differCount(sectionsAfter, snap(fake, sections)), 0, "redo puts the section frames back");
    await session.undo();
    await fake.flush();
    assert.equal(differCount(before, snap(fake, ids)), 0, "undo after redo is the pre-drag layout again");
    assert.equal(differCount(sectionsBefore, snap(fake, sections)), 0);
  } finally {
    restore();
  }
});

test("one undo restores cards when the drag moves a section origin and rebases its members", async () => {
  const { fake, session, restore } = open();
  try {
    const ids = cardIds(session);
    const sections = sectionIds(session);
    const picked = [];
    for (const sid of ["bs0", "bs1"]) picked.push(...session.board.items.get(sid).members.slice(0, 5));
    assert.equal(picked.length, 10);
    const before = snap(fake, ids);
    const sectionsBefore = snap(fake, sections);
    await session.commitMove(picked, 0, -40);
    await fake.flush();
    const sectionsAfter = snap(fake, sections);
    assert.ok(differCount(sectionsBefore, sectionsAfter) >= 2, "both section frames move");
    const after = snap(fake, ids);
    let movedCards = 0;
    for (const id of ids) if (JSON.stringify(before.get(id).plexus) !== JSON.stringify(after.get(id).plexus)) movedCards += 1;
    assert.ok(movedCards > 45, `rebase writes ${movedCards} cards, past one native chunk`);
    await session.undo();
    await fake.flush();
    const left = differCount(before, snap(fake, ids));
    assert.equal(left, 0, `one Cmd+Z left ${left} cards different after a section-origin move`);
    assert.equal(differCount(sectionsBefore, snap(fake, sections)), 0);
  } finally {
    restore();
  }
});

test("one undo restores every card when the pacer spaces the writes", async () => {
  let t = 0;
  const waits = [];
  const { fake, session, restore } = open({
    host: { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } },
  });
  try {
    const ids = cardIds(session);
    assert.equal(ids.length, 1560);
    const before = snap(fake, ids);
    await session.commitMove(ids, 10, 0);
    assert.ok(waits.length > 0, "writes past the burst wait on the frozen clock");
    await session.undo();
    const left = differCount(before, snap(fake, ids));
    assert.equal(left, 0, `one Cmd+Z left ${left} of ${ids.length} cards different while writes were spaced`);
  } finally {
    restore();
  }
});

test("a drag over 600 writes asks, then one undo restores every card; a refusal writes nothing", async () => {
  let t = 0;
  const asked = [];
  const yes = open({
    host: { now: () => t, sleep: async (ms) => { t += ms; } },
    session: { confirmBulk: (n) => { asked.push(n); return true; } },
  });
  try {
    const ids = cardIds(yes.session);
    assert.equal(ids.length, 1560);
    const before = snap(yes.fake, ids);
    await yes.session.commitMove(ids, 10, 0);
    assert.equal(asked.length, 1);
    assert.ok(asked[0] > 600, `confirm saw ${asked[0]} writes`);
    await yes.session.undo();
    const left = differCount(before, snap(yes.fake, ids));
    assert.equal(left, 0, `one Cmd+Z left ${left} of ${ids.length} cards different after a confirmed bulk drag`);
  } finally {
    yes.restore();
  }
  resetSessions();
  const no = open({ session: { confirmBulk: () => false } });
  try {
    const ids = cardIds(no.session);
    const before = snap(no.fake, ids);
    no.fake.clearLog();
    await no.session.commitMove(ids, 10, 0);
    assert.equal(differCount(before, snap(no.fake, ids)), 0, "a refused confirm leaves the graph alone");
    assert.equal(no.fake.writesLog().length, 0);
  } finally {
    no.restore();
  }
});
