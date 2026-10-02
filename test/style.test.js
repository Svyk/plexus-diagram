import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createPropsPanel } from "../src/view/props-panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => resetSessions());

const card = (uid, x, y, extra = {}) => ({ uid, string: uid, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });
const section = (uid, x, y, w, h, children = [], extra = {}) => ({
  uid, string: uid, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children,
});

function setup(children, boardPlexus = { v: 2 }) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { "rf-diagram": { keep: 1 }, plexus: boardPlexus }, children });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, session };
}

const plexus = (fake, uid) => fake.props(uid).plexus;

test("setItemStyle writes font, color, align, fill, and border in one step and leaves layout and accent", async () => {
  const { fake, session } = setup([card("a", 10, 20, { color: "teal", look: "block" }), card("b", 30, 40)]);
  const n = await session.setItemStyle(["a", "b"], { fontSize: 20, textColor: "#F55656", align: "center", fill: "red", border: "#112233" });
  assert.equal(n, 2);
  assert.equal(fake.writesLog().filter((e) => e[0] === "update").length, 2);
  assert.deepEqual(plexus(fake, "a"), {
    x: 10, y: 20, w: 200, h: 100, color: "teal", look: "block",
    fontSize: 20, textColor: "#f55656", align: "center", fill: "red", border: "#112233",
  });
  fake.clearLog();
  await session.resetItemStyle(["a"]);
  assert.deepEqual(plexus(fake, "a"), { x: 10, y: 20, w: 200, h: 100, color: "teal", look: "block" });
});

test("setItemStyle writes and clears a text shape and does not store one on a card", async () => {
  const text = (uid) => ({ uid, string: uid, props: { plexus: { type: "text", x: 0, y: 0, w: 200, h: 80 } } });
  const { fake, session } = setup([text("t"), card("a", 10, 20, { color: "teal" })]);
  const n = await session.setItemStyle(["t", "a"], { shape: "diamond" });
  assert.equal(n, 1);
  assert.equal(plexus(fake, "t").shape, "diamond");
  assert.equal(plexus(fake, "a").shape, undefined);
  assert.equal(plexus(fake, "a").color, "teal");
  await session.setItemStyle(["t"], { shape: "hexagon" });
  assert.equal(plexus(fake, "t").shape, undefined);
  await session.setItemStyle(["t"], { shape: "cylinder" });
  assert.equal(plexus(fake, "t").shape, "cylinder");
  await session.setItemStyle(["t"], { shape: null });
  assert.equal(plexus(fake, "t").shape, undefined);
  await session.setItemStyle(["t"], { shape: "ellipse" });
  await session.resetItemStyle(["t"]);
  assert.equal(plexus(fake, "t").shape, undefined);
  assert.equal(plexus(fake, "t").type, "text");
});

test("card fontSize 14 is omitted and a section style does not land on a card", async () => {
  const { fake, session } = setup([card("a", 1, 2), section("s", 0, 0, 400, 300)]);
  await session.setItemStyle(["a", "s"], { fontSize: 14, textColor: "#abcdef" });
  assert.equal(plexus(fake, "a").fontSize, undefined);
  assert.equal(plexus(fake, "a").textColor, "#abcdef");
  assert.equal(plexus(fake, "s").textColor, undefined);
  await session.setSectionStyle(["s", "a"], { titleSize: 22, titleColor: "blue", border: "#445566" });
  assert.equal(plexus(fake, "a").titleSize, undefined);
  assert.deepEqual(plexus(fake, "s"), { type: "section", x: 0, y: 0, w: 400, h: 300, titleSize: 22, titleColor: "blue", border: "#445566" });
  await session.resetSectionStyle(["s"]);
  assert.deepEqual(plexus(fake, "s"), { type: "section", x: 0, y: 0, w: 400, h: 300 });
});

test("section defaults and hex background live on the board block and reset removes only those keys", async () => {
  const { fake, session } = setup([card("a", 0, 0)], { v: 2, x: 5, zed: 1 });
  assert.equal(await session.setSectionDefaults({ titleSize: 22, titleColor: "#F55656", junk: 1 }), true);
  assert.deepEqual(plexus(fake, "b1").defaults, { section: { titleSize: 22, titleColor: "#f55656" } });
  assert.equal(plexus(fake, "b1").zed, 1);
  assert.equal(await session.setBoardBackground({ bg: "cross", bgColor: "#ABCDEF" }), true);
  assert.equal(plexus(fake, "b1").bg, "cross");
  assert.equal(plexus(fake, "b1").bgColor, "#abcdef");
  assert.equal(session.board.background.pattern, "cross");
  assert.equal(session.board.background.tone, "#abcdef");
  assert.equal(await session.setBoardBackground({ bgColor: "chartreuse" }), false);
  assert.equal(plexus(fake, "b1").bgColor, "#abcdef");
  await session.resetSectionDefaults();
  assert.equal(plexus(fake, "b1").defaults, undefined);
  assert.equal(plexus(fake, "b1").bg, "cross");
  await session.setBoardBackground({ bg: null, bgColor: null });
  assert.deepEqual(plexus(fake, "b1"), { v: 2, x: 5, zed: 1 });
});

test("animated edge color is hex and reset restores direction, route, dash, and color", async () => {
  const { fake, session } = setup([card("a", 0, 0), card("b", 300, 0)]);
  const id = await session.addEdge({ from: "a", to: "b" });
  fake.clearLog();
  await session.updateEdge(id, { dash: "animated", color: "#F55656", route: "elbow", dir: "none" });
  const edge = plexus(fake, id);
  assert.equal(edge.dash, "animated");
  assert.equal(edge.color, "#f55656");
  assert.equal(edge.route, "elbow");
  assert.equal(edge.dir, "none");
  await session.updateEdge(id, { dir: "one", route: "curve", dash: "solid", color: null });
  const reset = plexus(fake, id);
  assert.equal(reset.dash, undefined);
  assert.equal(reset.color, undefined);
  assert.equal(reset.route, undefined);
  assert.equal(reset.dir, undefined);
  assert.equal(reset.from, "a");
  assert.equal(reset.to, "b");
});

test("properties panel: empty selection, block stepper, collapse memory, edge group", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    const bar = stub.document.createElement("div");
    bar.className = "pxd-toolbar";
    root.append(bar);
    stub.document.body.append(root);
    const calls = [];
    const mem = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
    const panel = createPropsPanel({
      doc: stub.document,
      root,
      storage: mem,
      on: {
        setItemStyle: (p) => calls.push(["item", p]),
        resetItems: () => calls.push(["reset-items"]),
        setEdge: (p) => calls.push(["edge", p]),
        setBackground: (p) => calls.push(["bg", p]),
        setDefaults: (p) => calls.push(["defaults", p]),
      },
    });
    panel.refresh({ items: [], edge: null, board: { plexus: { v: 2 }, defaults: { section: {} } } });
    assert.ok(root.querySelector("[data-group=\"defaults\"]"));
    assert.ok(root.querySelector("[data-group=\"diagram\"]"));
    assert.equal(root.querySelector("[data-group=\"blocks\"]"), null);
    const toggle = root.querySelector(".pxd-props__toggle");
    toggle.click();
    assert.equal(panel.isCollapsed(), true);
    assert.equal(mem["pxd-props-collapsed"], "1");
    assert.equal(root.querySelector(".pxd-props__body").style.display, "none");
    toggle.click();
    assert.equal(panel.isCollapsed(), false);
    panel.refresh({
      items: [{ uid: "a", type: "card", fontSize: undefined, textColor: undefined, align: undefined, fill: undefined, border: undefined }],
      edge: null,
      board: { plexus: {} },
    });
    assert.ok(root.querySelector("[data-group=\"blocks\"]"));
    assert.equal(root.querySelector("[data-group=\"defaults\"]"), null);
    root.querySelector(".pxd-props__inc").click();
    assert.deepEqual(calls.at(-1), ["item", { fontSize: 15 }]);
    root.querySelector(".pxd-props__reset").click();
    assert.deepEqual(calls.at(-1), ["reset-items"]);
    const chip = root.querySelector(".pxd-props__chip");
    chip.click();
    const swatch = root.querySelector("[data-color=\"#f55656\"]");
    assert.ok(swatch);
    swatch.click();
    assert.deepEqual(calls.at(-1), ["item", { textColor: "#f55656" }]);
    panel.refresh({
      items: [],
      edge: { uid: "e", dir: "one", dash: "solid", route: "curve", color: undefined },
      board: { plexus: { bg: "dots" } },
    });
    assert.ok(root.querySelector("[data-group=\"edge\"]"));
    assert.equal(root.querySelector("[data-group=\"blocks\"]"), null);
    const animated = [...root.querySelectorAll("[data-value=\"animated\"]")];
    assert.equal(animated.length, 1);
    animated[0].click();
    assert.deepEqual(calls.at(-1), ["edge", { dash: "animated" }]);
    const cross = [...root.querySelectorAll("[data-value=\"cross\"]")];
    cross[0].click();
    assert.deepEqual(calls.at(-1), ["bg", { bg: "cross" }]);
    panel.dispose();
  } finally {
    restore();
  }
});
