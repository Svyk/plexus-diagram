import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { readV06Entry } from "../src/host/migrate.js";
import { buildBoard } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import "../src/session-clip.js";
import "../src/snapshots.js";
import "../src/templates.js";

afterEach(() => resetSessions());

const row = (string, children = []) => ({ string, children });
const settings = { get: (k) => (k === "graph-links" ? "off" : undefined) };

function outline(fake, uid) {
  return fake.children(uid).map((id) => ({
    string: fake.block(id).string,
    props: fake.props(id),
    children: outline(fake, id),
  }));
}

function seed04(fake) {
  fake.seedPage({
    title: "plexus-diagram/metadata",
    uid: "meta04",
    children: [
      row("enhanced::", [
        { uid: "entry04", string: "b04", children: [
          row("viewport:: 1,2,1"),
          row("node n1", [row("pos:: 12,20"), row("size:: 280,160"), row("color:: teal")]),
          row("node n2", [row("pos:: 400,20"), row("size:: 200,80")]),
          row("edge n1->n2", [row("label:: causes")]),
        ] },
      ]),
    ],
  });
  fake.seedBoard({
    uid: "b04",
    string: "{{[[diagram]]:Zero four}}",
    props: { "rf-diagram": { keep: true } },
    children: [
      { uid: "n1", string: "[[Cause]]" },
      { uid: "n2", string: "[[Effect]]" },
    ],
  });
}

function seed06(fake) {
  fake.seedPage({
    title: "plexus-diagram/metadata",
    uid: "meta06",
    children: [
      row("enhanced::", [
        { uid: "entry06", string: "b06", children: [
          row("viewport:: 5,6,0.5"),
          row("node c1", [row("pos:: 10,10"), row("size:: 280,160"), row("color:: teal")]),
          row("node c2", [row("pos:: 700,20"), row("size:: 300,100")]),
          row("edge c1->c2", [row("kind:: bezier"), row("label:: causes"), row("direction:: twoWay"), row("from:: right"), row("to:: left"), row("color:: red")]),
          row("section s-old", [row("pos:: 0,0"), row("size:: 400,300"), row("title:: Group"), row("color:: blue")]),
        ] },
      ]),
    ],
  });
  fake.seedBoard({
    uid: "b06",
    props: { "rf-diagram": { keep: true } },
    children: [
      { uid: "c1", string: "[[A]]" },
      { uid: "c2", string: "[[B]]" },
    ],
  });
}

function seed10(fake) {
  fake.seedBoard({
    uid: "b10",
    string: "{{[[diagram]]:One oh}}",
    props: { "rf-diagram": { keep: true }, plexus: { v: 2, bg: "dots" } },
    children: [
      { uid: "a10", string: "Note", props: { plexus: { x: 10, y: 20, w: 280, h: 160, color: "teal" } } },
      { uid: "t10", string: "Label", props: { plexus: { type: "text", x: 40, y: 200, w: 240, h: 48, fontSize: 32 } } },
      {
        uid: "e10", string: "Connections", open: false, props: { plexus: { type: "edges" } },
        children: [
          { uid: "edge10", string: "((a10)) → ((t10))", props: { plexus: { type: "edge", from: "a10", to: "t10", dir: "one", route: "curve", weight: 3 } } },
        ],
      },
    ],
  });
}

function seed11(fake) {
  fake.seedBoard({
    uid: "b11",
    string: "{{[[diagram]]:One one}}",
    props: { plexus: { v: 2, bg: "lines" } },
    children: [
      {
        uid: "h11", string: "Evidence", heading: 1,
        children: [
          { uid: "m11", string: "member", props: { plexus: { x: 16, y: 24, w: 200, h: 80, collapsed: true } } },
        ],
      },
      {
        uid: "nb11", string: "{{[[diagram]]:Inner}}",
        props: { plexus: { x: 400, y: 40, w: 320, h: 220, v: 2 } },
        children: [
          { uid: "inner11", string: "[[Inside]]", props: { plexus: { x: 12, y: 16, w: 200, h: 80 } } },
        ],
      },
    ],
  });
}

function seed12(fake) {
  fake.seedBoard({
    uid: "b12",
    string: "{{[[diagram]]:One two}}",
    props: { plexus: { v: 2, bg: "grid", bgColor: "paper" } },
    children: [
      {
        uid: "s12", string: "Lane",
        props: { plexus: { type: "section", x: 0, y: 0, w: 480, h: 320, color: "blue", fit: false, pinned: true } },
        children: [
          { uid: "p12", string: "Pinned", props: { plexus: { x: 24, y: 40, w: 200, h: 100, pinned: true, fontSize: 16 } } },
        ],
      },
    ],
  });
}

async function openOf(fake, uid) {
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const before = {
    board: outline(fake, uid),
    props: fake.props(uid),
    meta04: fake.has("meta04") ? outline(fake, "meta04") : null,
    meta06: fake.has("meta06") ? outline(fake, "meta06") : null,
  };
  fake.clearLog();
  const stub = createDomStub();
  const restore = stub.install();
  const session = acquireSession(uid, { host, settings, linkDelay: 0 });
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings, version: "1.3.0", initialViewport: { x: 0, y: 0, zoom: 1 } });
  for (let i = 0; i < 6; i++) {
    stub.flushFrames();
    stub.flushTimers();
    stub.flushIdle();
  }
  await session.idle();
  return { host, session, view, stub, restore, before };
}

function assertUntouched(fake, uid, opened) {
  assert.equal(fake.writesLog().length, 0, uid);
  assert.deepEqual(fake.props(uid), opened.before.props);
  assert.deepEqual(outline(fake, uid), opened.before.board);
  if (opened.before.meta04) assert.deepEqual(outline(fake, "meta04"), opened.before.meta04);
  if (opened.before.meta06) assert.deepEqual(outline(fake, "meta06"), opened.before.meta06);
}

function close(opened) {
  opened.view.dispose();
  opened.session.release();
  opened.restore();
  resetSessions();
}

test("HARD-2 a 0.4 metadata board opens with no writes", async () => {
  const fake = createFakeRoam();
  seed04(fake);
  const opened = await openOf(fake, "b04");
  try {
    assert.equal(opened.session.board.enhanced, false);
    assert.equal(opened.session.board.items.get("n1").type, "card");
    assert.ok(opened.view.root.querySelector('[data-uid="n1"]'));
    const src = readV06Entry(opened.host, "b04");
    assert.equal(src.nodes.get("n1").color, "teal");
    assert.equal(src.edges[0].label, "causes");
    assert.equal(src.sections.length, 0);
    assertUntouched(fake, "b04", opened);
    assert.equal(fake.children("entry04").some((id) => fake.block(id).string.startsWith("migrated::")), false);
  } finally {
    close(opened);
  }
});

test("HARD-2 a 0.6 metadata board opens with no writes", async () => {
  const fake = createFakeRoam();
  seed06(fake);
  const opened = await openOf(fake, "b06");
  try {
    assert.equal(opened.session.board.enhanced, false);
    assert.ok(opened.view.root.querySelector('[data-uid="c1"]'));
    const src = readV06Entry(opened.host, "b06");
    assert.equal(src.sections[0].title, "Group");
    assert.equal(src.edges[0].dir, "two");
    assert.equal(src.edges[0].route, "curve");
    assertUntouched(fake, "b06", opened);
    assert.equal(fake.children("entry06").some((id) => fake.block(id).string.startsWith("migrated::")), false);
  } finally {
    close(opened);
  }
});

test("HARD-2 a 1.0 props board opens with no writes", async () => {
  const fake = createFakeRoam();
  seed10(fake);
  const opened = await openOf(fake, "b10");
  try {
    const board = opened.session.board;
    assert.equal(board.enhanced, true);
    assert.equal(board.background.pattern, "dots");
    assert.equal(board.items.get("a10").x, 10);
    assert.equal(board.items.get("a10").color, "teal");
    assert.equal(board.items.get("t10").type, "text");
    assert.equal(board.items.get("t10").fontSize, 32);
    assert.equal(board.edges.get("edge10").weight, 3);
    assert.ok(opened.view.root.querySelector('[data-uid="a10"]'));
    assert.ok(opened.view.root.querySelector('[data-uid="t10"]'));
    assertUntouched(fake, "b10", opened);
    assert.equal(fake.props("b10")["rf-diagram"].keep, true);
  } finally {
    close(opened);
  }
});

test("HARD-2 a 1.1 nested board opens with no writes", async () => {
  const fake = createFakeRoam();
  seed11(fake);
  const opened = await openOf(fake, "b11");
  try {
    const board = opened.session.board;
    assert.equal(board.items.get("h11").type, "section");
    assert.equal(board.items.get("m11").collapsed, true);
    assert.equal(board.items.get("nb11").enhanced, true);
    const nested = buildBoard(opened.host.pullBoard("nb11"));
    assert.equal(nested.enhanced, true);
    assert.equal(nested.items.get("inner11").x, 12);
    assert.ok(opened.view.root.querySelector('[data-uid="nb11"]'));
    assert.equal(fake.props("h11").plexus, undefined);
    assertUntouched(fake, "b11", opened);
  } finally {
    close(opened);
  }
});

test("HARD-2 a 1.2 board opens with no writes", async () => {
  const fake = createFakeRoam();
  seed12(fake);
  const opened = await openOf(fake, "b12");
  try {
    const board = opened.session.board;
    assert.equal(board.background.pattern, "grid");
    assert.equal(board.background.tone, "paper");
    assert.equal(board.items.get("s12").pinned, true);
    assert.equal(board.items.get("s12").autofit, false);
    assert.equal(board.items.get("p12").pinned, true);
    assert.equal(board.items.get("p12").fontSize, 16);
    assert.equal(fake.props("s12").plexus.h, 320);
    assert.ok(opened.view.root.querySelector('[data-uid="s12"]'));
    assertUntouched(fake, "b12", opened);
  } finally {
    close(opened);
  }
});
