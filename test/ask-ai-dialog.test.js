import assert from "node:assert/strict";
import test from "node:test";

import { openAskAI, paintAnswer } from "../src/view/ask-ai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }, { n: 2 }],
  order: ["h", "p"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
    p: { id: "p", type: "para", page: 2, text: "Sodium was 12 mg." },
  },
};

function fakeWindow(api) {
  const listeners = new Map();
  return {
    LiveAI_API: api,
    AbortController,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
    count: (type) => (listeners.get(type) || []).length,
  };
}

function find(node, cls) {
  if (node.className?.split?.(" ").includes(cls)) return node;
  for (const kid of node.children || []) {
    const hit = find(kid, cls);
    if (hit) return hit;
  }
  return null;
}

test("no Live AI: setup hint instead of the form, form appears on api-ready, Esc closes", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const w = fakeWindow(undefined);
    const dialog = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
    assert.ok(dialog);
    assert.match(find(dialog.el, "pxd-ask__hint").textContent, /Enable Public API/);
    assert.equal(find(dialog.el, "pxd-ask__send"), null);
    assert.match(find(dialog.el, "pxd-ask__chip").textContent, /Paragraph · p\. 2/);

    w.LiveAI_API = {
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
      getDefaultModel: () => "m1",
      generate: async () => ({ text: "ok", model: "m1" }),
    };
    w.emit("liveai:api-ready");
    assert.ok(find(dialog.el, "pxd-ask__send"));
    assert.equal(find(dialog.el, "pxd-ask__model").children.length, 1);

    stub.dispatch(dialog.el, "keydown", { key: "Escape" });
    assert.equal(dialog.el.isConnected, false);
    assert.equal(w.count("liveai:api-ready"), 0);
  } finally {
    restore();
  }
});

test("send streams into the answer, [p. N] becomes a link that jumps", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    let seen = null;
    const w = fakeWindow({
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
      getDefaultModel: () => "m1",
      generate: async (options) => {
        seen = options;
        options.onChunk("12 mg [p. 2]");
        return { text: "12 mg [p. 2]", model: "m1", usage: null };
      },
    });
    const jumps = [];
    const dialog = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w, jumpPage: (n) => jumps.push(n) });
    find(dialog.el, "pxd-ask__send").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(seen.caller, "Plexus Diagram");
    assert.match(seen.context, /=== Selected part ===/);
    assert.match(seen.systemPrompt, /\[p\. N\]/);
    const cite = find(dialog.el, "pxd-ask__cite");
    assert.ok(cite);
    cite.click();
    assert.deepEqual(jumps, [2]);
    dialog.close();
  } finally {
    restore();
  }
});

test("paintAnswer leaves plain text untouched", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const node = doc.createElement("div");
    paintAnswer(doc, node, "no cites here", () => {});
    assert.equal(node.textContent, "no cites here");
  } finally {
    restore();
  }
});
