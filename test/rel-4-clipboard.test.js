import assert from "node:assert/strict";
import test from "node:test";
import { PLEXUS_MIME } from "../src/model/clipboard.js";
import { createClipboardIO } from "../src/view/clipboard-io.js";

function target() {
  return { nodeType: 1, tagName: "DIV", closest() { return null; } };
}

function clipboardEvent(type, store) {
  return {
    type,
    target: target(),
    clipboardData: {
      getData: (kind) => store[kind] ?? "",
      setData: (kind, value) => { store[kind] = value; },
    },
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function recordingTarget() {
  const handlers = new Map();
  return {
    handlers,
    node: {
      addEventListener(type, fn) { handlers.set(type, fn); },
      removeEventListener(type, fn) {
        if (handlers.get(type) === fn) handlers.delete(type);
      },
    },
  };
}

function wire(on) {
  const doc = recordingTarget();
  const win = recordingTarget();
  doc.node.defaultView = win.node;
  doc.node.activeElement = null;
  const io = createClipboardIO({
    doc: doc.node,
    ownsKeyboard: () => true,
    on,
  });
  return { doc, win, io };
}

const payload = {
  mime: JSON.stringify({
    v: 1,
    board: "board0001",
    bounds: { x: 0, y: 0, w: 10, h: 10 },
    items: [{ uid: "c1", string: "Note", x: 0, y: 0, w: 10, h: 10 }],
  }),
  text: "((c1))",
};

test("a copy event receives text/plain and the plexus mime", () => {
  const { doc, io } = wire({ getPayload: () => payload });
  const store = {};
  doc.handlers.get("copy")(clipboardEvent("copy", store));
  assert.equal(store["text/plain"], payload.text);
  assert.equal(store[PLEXUS_MIME], payload.mime);
  io.dispose();
});

test("a plexus paste calls the paste handler once", () => {
  let pastes = 0;
  let seen = null;
  const { doc, io } = wire({
    pastePlexus: (data) => { pastes += 1; seen = data; },
  });
  const store = { [PLEXUS_MIME]: payload.mime, "text/plain": payload.text };
  doc.handlers.get("paste")(clipboardEvent("paste", store));
  assert.equal(pastes, 1);
  assert.equal(seen.v, 1);
  assert.equal(seen.items.length, 1);
  io.dispose();
});

test("a cut event calls the cut-done handler once", () => {
  let cuts = 0;
  const { doc, io } = wire({
    getPayload: () => payload,
    cutDone: () => { cuts += 1; },
  });
  const store = {};
  doc.handlers.get("cut")(clipboardEvent("cut", store));
  assert.equal(cuts, 1);
  assert.equal(store[PLEXUS_MIME], payload.mime);
  assert.equal(store["text/plain"], payload.text);
  io.dispose();
});
