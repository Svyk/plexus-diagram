// PGE-1: a page card edits in place. Same box, no cross-fade, focus on the first frame the row exists.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createHost } from "../src/host/roam.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});
const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const PAGE = { ":x": 0, ":y": 0, ":w": 280, ":h": 160 };
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function tree(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push({ uid: `row${String(i).padStart(4, "0")}`, string: `Row ${i}`, children: [] });
  return out;
}

function harness({ pageBlocks = [] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderPage: [] };
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    renderPage(el, uid) { calls.renderPage.push(uid); },
    renderBlock() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline: () => ({ uid: "uid-Alpha", exists: true, blocks: pageBlocks }),
    pageUid: (t) => `uid-${t}`,
    openPage() {},
    watchPage() { return () => {}; },
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn) { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard([blk("pg0000001", "[[Alpha]]", PAGE, 0)]));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  return {
    stub, doc, host, calls, r,
    uid: board.order[0],
    shell: () => r.shellOf(board.order[0]),
    done() { r.dispose(); restore(); },
  };
}

test("PGE: renderPage forwards hide-mentions and does not let options replace uid or el", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const el = {};
  host.renderPage(el, "pageuid01", { "hide-mentions?": true, uid: "nope", el: {} });
  const arg = fake.calls.find((c) => c[0] === "renderPage")[1];
  assert.equal(arg.uid, "pageuid01");
  assert.equal(arg.el, el);
  assert.equal(arg["hide-mentions?"], true);
  host.renderPage(el, "pageuid02");
  const plain = fake.calls.filter((c) => c[0] === "renderPage")[1][1];
  assert.equal(plain.uid, "pageuid02");
  assert.equal(plain["hide-mentions?"], undefined);
});

test("PGE: page edit hides mentions, skips the cross-fade, and keeps the card box", async () => {
  const blocks = tree(4);
  const h = harness({ pageBlocks: blocks });
  try {
    const card = h.shell();
    card.style.height = "160px";
    card.style.width = "280px";
    const seen = [];
    h.host.renderPage = (el, uid, opts) => {
      seen.push({ uid, opts });
      const input = h.doc.createElement("textarea");
      input.className = "rm-block__input";
      input.id = `block-input-body-${blocks[0].uid}`;
      el.append(input);
    };
    const ok = await h.r.enterEdit(h.uid, { row: blocks[0].uid });
    assert.equal(ok, true);
    assert.deepEqual(seen, [{ uid: "uid-Alpha", opts: { "hide-mentions?": true } }]);
    assert.equal(card.classList.contains("pxd-item--xfade"), false);
    assert.equal(card.style.height, "160px");
    assert.equal(card.style.width, "280px");
    const editor = card.querySelector(".pxd-item__editor");
    assert.ok(editor.classList.contains("pxd-page-edit"));
    await h.r.exitEdit();
    assert.equal(card.style.height, "160px");
    assert.equal(card.style.width, "280px");
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.querySelector(".pxd-item__editor"), null);
    assert.ok(card.querySelector("[data-pxd-row]"), "exit paints the page rows again");
    assert.equal(card.classList.contains("pxd-item--xfade"), false);
  } finally { h.done(); }
});

test("PGE: focus lands on the first frame the clicked row exists", async () => {
  const blocks = tree(4);
  const h = harness({ pageBlocks: blocks });
  try {
    const row = blocks[2].uid;
    const events = [];
    h.host.renderPage = (el) => {
      let left = 2;
      const step = () => {
        left -= 1;
        if (left > 0) {
          events.push("frame");
          requestAnimationFrame(step);
          return;
        }
        events.push("input");
        const input = h.doc.createElement("textarea");
        input.className = "rm-block__input";
        input.id = `block-input-body-${row}`;
        input.focus = () => { events.push("focus"); };
        el.append(input);
      };
      requestAnimationFrame(step);
    };
    const pending = h.r.enterEdit(h.uid, { row });
    let flushes = 0;
    while (!events.includes("focus") && flushes < 6) {
      h.stub.flushFrames();
      flushes += 1;
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.ok(events.includes("focus"));
    assert.equal(events[events.indexOf("input") + 1], "focus");
    assert.ok(flushes <= 3, `focused after ${flushes} frames`);
    assert.equal(h.shell().classList.contains("pxd-item--xfade"), false);
    await pending;
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

test("PGE: page-edit CSS scrolls inside the card and hides the second title and mentions", () => {
  const css = readFileSync(new URL("../src/css/page-edit.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-page-edit \{[^}]*overflow: auto/);
  assert.match(css, /\.pxd-item--page\.pxd-item--editing \{[^}]*max-height: none/);
  assert.match(css, /\.rm-title-display/);
  assert.match(css, /\.rm-reference-main/);
  assert.match(css, /font-size: 13px !important/);
});
