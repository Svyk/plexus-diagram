import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/templates.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", string: "{{[[diagram]]:Fixture}}", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  return { fake, session };
}

const CANVAS = JSON.stringify({
  nodes: [
    { id: "g", type: "group", label: "Stage", x: 0, y: 0, width: 500, height: 300 },
    { id: "a", type: "text", text: "Alpha", x: 20, y: 40, width: 200, height: 80 },
    { id: "b", type: "text", text: "Beta", x: 260, y: 40, width: 200, height: 80 },
    { id: "f", type: "file", file: "Notes/Gamma.md", x: 600, y: 40, width: 200, height: 80 },
  ],
  edges: [
    { id: "e1", fromNode: "a", toNode: "b", label: "then" },
    { id: "e2", fromNode: "b", toNode: "f" },
  ],
});

const plexusOf = (fake, uid) => fake.block(uid).props?.plexus;

test("PXD-10: importCanvas writes one nested board with sections, cards and arrows, and Undo removes it", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const uid = await session.importCanvas(CANVAS, { x: 40, y: 50, w: 320, h: 220 }, "Line map.canvas");
  assert.ok(uid);
  assert.equal(fake.block(uid).parent, "b1");
  assert.match(fake.block(uid).string, /Line map/);
  const kids = fake.children(uid);
  const section = kids.find((id) => plexusOf(fake, id)?.type === "section");
  assert.ok(section, "the group becomes a section");
  assert.equal(fake.block(section).string, "Stage");
  assert.deepEqual(fake.children(section).map((id) => fake.block(id).string).sort(), ["Alpha", "Beta"]);
  const hub = kids.find((id) => plexusOf(fake, id)?.type === "edges");
  const edges = fake.children(hub);
  assert.equal(edges.length, 2);
  const ids = new Set();
  const walk = (id) => { ids.add(id); fake.children(id).forEach(walk); };
  walk(uid);
  for (const id of edges) {
    const px = plexusOf(fake, id);
    assert.equal(px.type, "edge");
    assert.ok(ids.has(px.from) && ids.has(px.to), "arrow ends are blocks of the new board");
  }
  assert.ok(edges.some((id) => fake.block(id).string.includes(" then ")));
  const undo = toasts.at(-1);
  assert.match(undo.message, /^Imported Line map: 3 cards, 1 sections, 2 arrows$/);
  await undo.action.run();
  assert.equal(fake.block(uid), null);
  assert.deepEqual(fake.children("b1"), []);
});

test("PXD-10: importCanvas on bad JSON toasts the error and writes nothing", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  assert.equal(await session.importCanvas("{not json", null, "x.canvas"), null);
  assert.ok(toasts.at(-1).message.length > 0);
  assert.deepEqual(fake.children("b1"), []);
});

test("PXD-10: an empty canvas is refused with a toast", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  assert.equal(await session.importCanvas(JSON.stringify({ nodes: [], edges: [] }), null, "x.canvas"), null);
  assert.equal(toasts.at(-1).message, "This canvas is empty.");
  assert.deepEqual(fake.children("b1"), []);
});

test("PXD-10: board and canvas menus offer JSON Canvas import and export", () => {
  const ids = (menu) => flattenMenu(menu).map((item) => item.id);
  assert.ok(ids(buildMenu("board-menu", {})).includes("export-canvas"));
  assert.ok(ids(buildMenu("canvas", {})).includes("import-canvas"));
  assert.ok(ids(buildMenu("canvas", {})).includes("export-canvas"));
});
