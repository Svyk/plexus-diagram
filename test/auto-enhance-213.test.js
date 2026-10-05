import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { autoEligibility, storedLayoutIn } from "../src/discovery.js";
import { createSettingsPanel, normalizeSetting, settingsDefaults } from "../src/settings.js";
import { withBoardMarker } from "../src/model/schema.js";

afterEach(() => resetSessions());

// ---- settings, schema, discovery ----

test("AE-1 auto-enhance defaults to true, is a Board-group switch right after Enabled, and coerces", () => {
  assert.equal(settingsDefaults()["auto-enhance"], true);
  assert.equal(normalizeSetting("auto-enhance", "false"), false);
  assert.equal(normalizeSetting("auto-enhance", null), true);
  const rows = createSettingsPanel().settings.map((row) => row.id);
  assert.equal(rows[rows.indexOf("enabled") + 1], "auto-enhance");
  const row = createSettingsPanel().settings.find((r) => r.id === "auto-enhance");
  assert.equal(row.action.type, "switch");
  assert.equal(row.name, "Every diagram is a Plexus board");
});

test("AE-1 withBoardMarker off sets native and drops v; on clears native and sets v", () => {
  assert.deepEqual(withBoardMarker({ x: 1, v: 2, bg: "dots" }, false), { x: 1, native: true });
  assert.deepEqual(withBoardMarker(null, false), { native: true });
  assert.deepEqual(withBoardMarker({ native: true }, true), { v: 2 });
  assert.deepEqual(withBoardMarker({ x: 1, native: true }, true), { x: 1, v: 2 });
});

test("AE-1 autoEligibility", () => {
  assert.equal(autoEligibility({ plexus: null, nativeNodeCount: 0, storedLayout: false }), "virtual");
  assert.equal(autoEligibility({ plexus: { bg: "dots" }, nativeNodeCount: 0, storedLayout: false }), "virtual");
  assert.equal(autoEligibility({ plexus: null, nativeNodeCount: 3, storedLayout: false }), "convert");
  assert.equal(autoEligibility({ plexus: null, nativeNodeCount: 0, storedLayout: true }), "convert");
  assert.equal(autoEligibility({ plexus: { v: 2 }, nativeNodeCount: 3, storedLayout: true }), null);
  assert.equal(autoEligibility({ plexus: { native: true }, nativeNodeCount: 0, storedLayout: false }), null);
  assert.equal(autoEligibility({ plexus: { native: true }, nativeNodeCount: 3, storedLayout: true }), null);
  assert.equal(autoEligibility({}), "virtual");
});

test("AE-1 storedLayoutIn needs finite x and y on a direct child", () => {
  assert.equal(storedLayoutIn([{ ":block/props": { ":plexus": { ":x": 1, ":y": 2 } } }]), true);
  assert.equal(storedLayoutIn([{ ":block/props": { ":plexus": { ":x": 1 } } }, { ":block/props": null }, {}]), false);
  assert.equal(storedLayoutIn(null), false);
});

// ---- session ----

function setup({ settings = null, virtual = true, children, props = { "rf-diagram": { keep: 1 } } } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props,
    children: children ?? [{ uid: "c1", string: "hello" }, { uid: "c2", string: "world" }],
  });
  const groups = { n: 0 };
  const group = host.group;
  host.group = (fn) => { groups.n += 1; return group(fn); };
  const session = acquireSession("b1", { host, settings, virtual, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session, groups };
}

const writes = (fake) => fake.writesLog().map((e) => `${e[0]}:${e[1]}`);

test("AE-1 a virtual session shows an enhanced board and opening or rebuilding writes nothing", async () => {
  const { fake, session, groups } = setup();
  assert.equal(session.board.enhanced, true);
  assert.equal(session.board.virtual, true);
  assert.equal(session.board.items.size, 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(writes(fake), []);
  assert.equal(groups.n, 0);
  assert.equal(fake.props("b1").plexus, undefined);
  assert.equal(fake.block("b1").open, true);
});

test("AE-1 the first move writes the marker and folds in the same group; the second move writes no marker", async () => {
  const { fake, session, groups } = setup();
  await session.commitMove(["c1"], 10, 20);
  assert.equal(groups.n, 1, "one user operation is one group");
  assert.deepEqual(writes(fake).sort(), ["update:b1", "update:b1", "update:c1"]);
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
  assert.deepEqual(fake.props("b1")["rf-diagram"], { keep: 1 });
  assert.equal(fake.block("b1").open, false);
  assert.equal(fake.props("c1").plexus.x, 10);
  assert.ok(!session.board.virtual);
  assert.equal(session.board.enhanced, true);
  fake.clearLog();
  await session.commitMove(["c2"], 30, 40);
  assert.equal(groups.n, 2);
  assert.deepEqual(writes(fake), ["update:c2"]);
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
});

test("AE-1 the stamp does not fold when Collapse the outline is off or the block is already folded", async () => {
  const off = setup({ settings: { "collapse-outline": false } });
  await off.session.commitMove(["c1"], 10, 20);
  assert.deepEqual(off.fake.props("b1").plexus, { v: 2 });
  assert.equal(off.fake.block("b1").open, true);
  assert.deepEqual(writes(off.fake).sort(), ["update:b1", "update:c1"]);
  resetSessions();
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "hello" }] });
  await host.setOpen("b1", false);
  const session = acquireSession("b1", { host, settings: null, virtual: true, linkDelay: 0 });
  fake.clearLog();
  await session.commitMove(["c1"], 10, 20);
  assert.deepEqual(writes(fake).sort(), ["update:b1", "update:c1"]);
});

test("AE-1 a board props write merges the marker into one props write", async () => {
  const { fake, session } = setup();
  await session.setBoardBackground({ bg: "grid" });
  assert.deepEqual(fake.props("b1").plexus, { bg: "grid", v: 2 });
  assert.equal(writes(fake).filter((w) => w === "update:b1").length, 2, "one props write and one fold");
});

test("AE-1 enhance on a virtual board writes only the marker", async () => {
  const { fake, session } = setup();
  const res = await session.enhance();
  assert.deepEqual(res, { enhanced: true, kind: "virtual", counts: null });
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
  assert.equal(writes(fake).some((w) => w.startsWith("create:")), false);
  assert.ok(!session.board.virtual);
  assert.deepEqual(await session.enhance(), { enhanced: false, reason: "already" });
});

test("AE-1 restoreNative on a virtual board writes the native marker and the board is no longer enhanced", async () => {
  const { fake, session } = setup();
  await session.restoreNative();
  assert.deepEqual(fake.props("b1").plexus, { native: true });
  assert.equal(session.board.enhanced, false);
  assert.notEqual(session.board.virtual, true);
  assert.equal(session.board.native, true);
  const kinds = writes(fake);
  assert.equal(kinds.some((w) => w.startsWith("create:")), false);
});

test("AE-1 with the setting off a virtual-allowed session is not virtual; turning it on later needs no new session", () => {
  const off = setup({ settings: { "auto-enhance": false } });
  assert.equal(off.session.board.enhanced, false);
  assert.notEqual(off.session.board.virtual, true);
  resetSessions();
  const live = { "auto-enhance": false };
  const settings = { get: (id) => live[id] };
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "hello" }] });
  const plain = acquireSession("b1", { host, settings, linkDelay: 0 });
  assert.equal(plain.board.enhanced, false);
  const same = acquireSession("b1", { host, settings, virtual: true, linkDelay: 0 });
  assert.equal(same, plain);
  assert.equal(plain.board.enhanced, false, "auto is still off");
  live["auto-enhance"] = true;
  plain.allowVirtual();
  assert.equal(plain.board.enhanced, true);
  assert.equal(plain.board.virtual, true);
});

test("AE-1 a restored board (native marker) is never virtual", () => {
  const { session } = setup({ props: { plexus: { native: true } } });
  assert.equal(session.board.enhanced, false);
  assert.equal(session.board.native, true);
});

test("AE-1 write-path audit: setBlockOpen on a card stamps the board in the same group", async () => {
  const { fake, session, groups } = setup();
  assert.equal(await session.setBlockOpen("c1", false), true);
  assert.equal(groups.n, 1);
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
  assert.equal(fake.block("c1").open, false);
  assert.deepEqual(writes(fake).sort(), ["update:b1", "update:b1", "update:c1"]);
});

test("AE-1 write-path audit: a new drawing stamps the board before the drawing block is created", async () => {
  const { fake, session } = setup();
  const uid = await session.createDrawing({ x: 10, y: 10 });
  assert.ok(uid);
  const log = writes(fake);
  const firstCreate = log.findIndex((w) => w.startsWith("create:"));
  assert.ok(firstCreate > 0);
  assert.ok(log.slice(0, firstCreate).includes("update:b1"));
  assert.deepEqual(fake.props("b1").plexus, { v: 2 });
});

test("AE-1 write-path audit: moving cards into a virtual nested board stamps that board", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "hello", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "nb", string: "{{[[diagram]]:Inner}}", props: { plexus: { x: 400, y: 0, w: 320, h: 220 } } },
    ],
  });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  assert.equal(session.board.items.get("nb").enhanced, true, "a plain nested diagram is a board in auto mode");
  fake.clearLog();
  await session.moveIntoBoard(["c1"], "nb");
  assert.equal(fake.props("nb").plexus.v, 2);
  assert.equal(fake.props("c1").plexus.x !== 0 || fake.block("c1").parent === "nb", true);
});

test("AE-1 a nested diagram is a board item only without native shapes and without the native marker", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "plain", string: "{{[[diagram]]:A}}", props: { plexus: { x: 0, y: 0 } } },
      { uid: "shapes", string: "{{[[diagram]]:B}}", props: { plexus: { x: 0, y: 300 } }, },
      { uid: "restored", string: "{{[[diagram]]:C}}", props: { plexus: { x: 0, y: 600, native: true } } },
      { uid: "laid", string: "{{[[diagram]]:D}}", props: { plexus: { x: 0, y: 900 } }, children: [{ uid: "lc", string: "x", props: { plexus: { x: 1, y: 2 } } }] },
    ],
  });
  fake.seedBoard({ uid: "shapesHolder", children: [] });
  const real = host.pullNative;
  host.pullNative = (id) => (id === "shapes" ? { ":diagram/nodes": [{ ":db/id": 1 }] } : real(id));
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  const enhanced = (id) => session.board.items.get(id).enhanced;
  assert.equal(enhanced("plain"), true);
  assert.equal(enhanced("shapes"), false);
  assert.equal(enhanced("restored"), false);
  assert.equal(enhanced("laid"), false);
  resetSessions();
  const off = acquireSession("b1", { host, settings: { "auto-enhance": false }, linkDelay: 0 });
  assert.equal(off.board.items.get("plain").enhanced, false);
});

test("AE-1 write-path audit: the highlighter flag on a virtual board stamps the marker in the same group", async () => {
  const { fake, session, groups } = setup();
  await session.setHighlighterTags(true);
  assert.equal(groups.n, 1);
  assert.deepEqual(fake.props("b1").plexus, { highlighterTags: true, v: 2 });
});
