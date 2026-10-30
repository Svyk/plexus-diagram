import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildBoard } from "../src/model/board.js";
import { PICTURE_MAX_SIDE, pictureString } from "../src/model/picture.js";
import { BOARD_MEMBER_RULE } from "../src/model/board-rule.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { pngScale } from "../src/view/board-view.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/picture.js";
import "../src/templates.js";

afterEach(() => resetSessions());

const byId = (items, id) => flattenMenu(items).find((item) => item.id === id);

test("PXD-9: the picture string strips brackets and parentheses from the title", () => {
  assert.equal(
    pictureString({ url: "https://x/y.png", title: "A [b] (c)\nd", date: "2026-10-29" }),
    "![Plexus board: A b c d, 2026-10-29](https://x/y.png)",
  );
  assert.equal(PICTURE_MAX_SIDE, 4096);
});

test("PXD-9: pngScale caps the longest side at maxSide", () => {
  assert.equal(pngScale(800, 600), 2);
  assert.equal(pngScale(8192, 1000, 4096), 0.5);
  assert.equal(pngScale(1000, 8192, 4096), 0.5);
  assert.equal(pngScale(1000, 800, 4096), 2);
});

test("PXD-9: the picture child is not an item and the model reports it", () => {
  const board = buildBoard({
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]:Fixture}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      { ":block/uid": "c1", ":block/string": "Card", ":block/order": 0, ":block/props": { ":plexus": { ":x": 1, ":y": 2, ":w": 3, ":h": 4 } } },
      {
        ":block/uid": "pic",
        ":block/string": "![Plexus board: Fixture, 2026-10-29](https://f/a.png)",
        ":block/order": 1,
        ":block/open": false,
        ":block/props": { ":plexus": { ":type": "picture", ":at": "2026-10-29T10:00:00.000Z" } },
      },
    ],
  });
  assert.equal(board.items.has("pic"), false);
  assert.deepEqual([...board.items.keys()], ["c1"]);
  assert.equal(board.pictureUid, "pic");
  assert.deepEqual(board.picture, { uid: "pic", url: "https://f/a.png", at: "2026-10-29T10:00:00.000Z" });
  assert.ok(BOARD_MEMBER_RULE.includes('"picture"'));
});

test("PXD-9: the board menu shows Keep unchecked, then checked with Refresh", () => {
  const off = buildMenu("board-menu", {});
  assert.ok(!byId(off, "keep-picture").checked);
  assert.equal(byId(off, "refresh-picture"), undefined);
  const on = buildMenu("board-menu", { picture: true });
  assert.equal(byId(on, "keep-picture").checked, true);
  assert.equal(byId(on, "refresh-picture").label, "Refresh static picture");
});

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", string: "{{[[diagram]]:Fixture}}", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  return { fake, session };
}

test("PXD-9: keep creates one first child, refresh updates it, drop removes it; cards go after it and sort keeps it first", async () => {
  const { fake, session } = setup();
  const card1 = await session.createCard({ x: 10, y: 10, string: "One", w: 100, h: 60 });
  const uid = await session.keepPicture({ at: "t1", string: "![Plexus board: F, d](https://f/1.png)" });
  assert.equal(fake.block(uid).parent, "b1");
  assert.equal(fake.block(uid).open, false);
  assert.deepEqual(fake.props(uid).plexus, { type: "picture", at: "t1" });
  assert.equal(session.board.pictureUid, uid);
  assert.equal(session.board.picture.url, "https://f/1.png");
  const card2 = await session.createCard({ x: 200, y: 10, string: "Two", w: 100, h: 60 });
  const order = (id) => fake.block(id).order;
  assert.equal(order(uid), 0);
  assert.ok(order(card1) > order(uid));
  assert.ok(order(card2) > order(uid));
  await session.sortOutline();
  assert.equal(order(uid), 0);
  const again = await session.keepPicture({ at: "t2", string: "![Plexus board: F, d](https://f/2.png)" });
  assert.equal(again, uid);
  assert.equal(fake.block(uid).string, "![Plexus board: F, d](https://f/2.png)");
  assert.equal(fake.props(uid).plexus.at, "t2");
  assert.equal(session.board.picture.url, "https://f/2.png");
  assert.equal(await session.dropPicture(), true);
  assert.equal(session.board.pictureUid, null);
  assert.equal(await session.dropPicture(), false);
});

test("PXD-9: a refresh after the picture was turned off writes nothing", async () => {
  const { fake, session } = setup();
  const uid = await session.keepPicture({ at: "t1", string: "![Plexus board: F, d](https://f/1.png)" });
  assert.equal(await session.dropPicture(), true);
  assert.equal(fake.block(uid), null);
  fake.clearLog();
  assert.equal(await session.keepPicture({ at: "t2", string: "![Plexus board: F, d](https://f/2.png)", create: false }), null);
  assert.deepEqual(fake.children("b1"), []);
  assert.equal(session.board.pictureUid, null);
});

test("PXD-9: save as template leaves the static picture out", async () => {
  const { fake, session } = setup();
  await session.createCard({ x: 10, y: 10, string: "One", w: 100, h: 60 });
  await session.keepPicture({ at: "t1", string: "![Plexus board: F, d](https://f/1.png)" });
  const saved = await session.saveAsTemplate();
  const strings = fake.children(saved).map((id) => fake.block(id).string);
  assert.deepEqual(strings, ["One"]);
});
