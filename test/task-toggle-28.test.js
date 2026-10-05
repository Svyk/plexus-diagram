import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// Turning Better Tasks off has to rebuild task cards. The light checkbox is
// drawn into the body, so hiding chips alone leaves it on screen.

const raw = {
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [
    {
      ":block/uid": "cardAAAA1",
      ":block/string": "{{[[TODO]]}} wash line",
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } },
      ":block/children": [],
    },
  ],
};

function settingsOf(on) {
  const values = { "better-tasks": on, "task-chips": "full", "task-tool": false };
  return { get: (id) => (id in values ? values[id] : undefined) };
}

test("turning Better Tasks off removes the light checkbox", async () => {
  const board = buildBoard(raw);
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    globalThis.window.RoamExtensionTools = {
      "better-tasks": {
        tools: [
          { name: "bt_modify", execute: async () => ({ ok: true }) },
          { name: "bt_get_attributes", execute: async () => ({ attributes: [{ id: "due", name: "BT_attrDue", aliases: [] }] }) },
        ],
      },
    };
    const mountEl = doc.createElement("div");
    doc.body.append(mountEl);
    const view = mountBoardView({
      host: {
        graph: "Readwisenotes",
        renderString(el, string) { el.textContent = string; },
        renderBlock() {},
        renderPage() {},
        unmount() {},
        pagePreview: () => ({ exists: false, blocks: [] }),
        pullTree: () => [],
        blockString: () => null,
      },
      session: new Proxy({
        uid: board.uid,
        board,
        rects: worldRects(board),
        links: [],
        coveredEdges: new Set(),
        on() { return () => {}; },
      }, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === "symbol") return undefined;
          return () => {};
        },
      }),
      mountEl,
      settings: settingsOf(true),
      version: "2.8.0",
    });
    await Promise.resolve();
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();
    const body = view.root.querySelector("[data-uid=cardAAAA1]");
    const kids = body ? [...(body.children || [])].map((n) => n.className).join(",") : "no card";
    assert.equal(view.root.querySelectorAll(".pxd-task-check").length, 1, kids);

    view.setSettings(settingsOf(false));
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();
    assert.equal(view.root.querySelectorAll(".pxd-task-check").length, 0);
    view.dispose();
  } finally {
    restore();
  }
});
