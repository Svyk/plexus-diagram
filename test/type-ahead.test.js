// FIX-TYPE-1: keys typed before a new card's textarea is live are kept and replayed in order.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createTypeAhead } from "../src/view/type-ahead.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function textarea(doc, value = "") {
  const ta = { tagName: "TEXTAREA", value, selectionStart: value.length, selectionEnd: value.length, inputs: 0 };
  ta.focus = () => { doc.activeElement = ta; };
  ta.setRangeText = (text, start, end) => {
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
  };
  ta.dispatchEvent = (ev) => { if (ev.type === "input") ta.inputs += 1; return true; };
  return ta;
}

function setup({ execCommand = true } = {}) {
  const root = { tagName: "DIV" };
  const body = { tagName: "BODY" };
  const timers = [];
  const doc = { activeElement: root, defaultView: { Event: globalThis.Event } };
  const commands = [];
  if (execCommand) {
    doc.execCommand = (cmd, _ui, text) => {
      commands.push([cmd, text]);
      const ta = doc.activeElement;
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd);
      ta.inputs += 1;
      return true;
    };
  }
  const live = new Set();
  const ta = textarea(doc);
  live.add(ta);
  const ahead = createTypeAhead({
    doc,
    isTarget: (node) => live.has(node),
    later: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return () => { t.on = false; }; },
  });
  return { doc, root, body, ta, ahead, timers, commands, live };
}

function key(target, k, extra = {}) {
  const ev = { type: "keydown", key: k, code: extra.code || `Key${k.toUpperCase()}`, target, prevented: false, stopped: false, ...extra };
  ev.preventDefault = () => { ev.prevented = true; };
  ev.stopImmediatePropagation = () => { ev.stopped = true; };
  ev.stopPropagation = () => {};
  return ev;
}
function input(target, type, data, kind = "beforeinput") {
  const ev = { type: kind, inputType: type, data, target, prevented: false };
  ev.preventDefault = () => { ev.prevented = true; };
  ev.stopImmediatePropagation = () => {};
  return ev;
}

test("an unarmed type-ahead takes nothing", () => {
  const f = setup();
  const ev = key(f.root, "h");
  assert.equal(f.ahead.take(ev), false);
  assert.equal(ev.prevented, false);
  assert.equal(f.ahead.takeInput(input(f.root, "insertText", "x")), false);
});

test("keys typed on the board while armed are kept, swallowed, and replayed in order into the card's textarea", () => {
  const f = setup();
  f.ahead.arm();
  for (const k of "Hello") {
    const ev = key(f.root, k);
    assert.equal(f.ahead.take(ev), true, `took ${k}`);
    assert.equal(ev.prevented, true);
    assert.equal(ev.stopped, true, "no board shortcut runs (h = Hand, l = links)");
  }
  assert.equal(f.ahead.pending(), "Hello");
  f.doc.activeElement = f.ta;
  assert.equal(f.ahead.flush(f.ta), "Hello");
  assert.equal(f.ta.value, "Hello");
  assert.deepEqual(f.commands, [["insertText", "Hello"]], "one real insertText, so Roam sees an input event");
  assert.equal(f.ahead.isArmed(), false);
  assert.equal(f.ahead.take(key(f.ta, "x")), false, "disarmed after the replay");
});

test("Backspace edits the buffer; Enter, arrows and Delete are swallowed so they do not act on the new card", () => {
  const f = setup();
  f.ahead.arm();
  for (const k of ["a", "b", "Backspace", "c", "Enter", "ArrowLeft", "Delete", "Tab", "d"]) {
    const ev = key(f.root, k, { code: k });
    assert.equal(f.ahead.take(ev), true, k);
    assert.equal(ev.prevented, true, k);
  }
  assert.equal(f.ahead.pending(), "acd");
});

test("modified keys and Escape pass through; Escape drops the buffer", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.take(key(f.root, "a"));
  assert.equal(f.ahead.take(key(f.root, "z", { metaKey: true })), false);
  assert.equal(f.ahead.take(key(f.root, "c", { ctrlKey: true })), false);
  assert.equal(f.ahead.pending(), "a");
  const esc = key(f.root, "Escape", { code: "Escape" });
  assert.equal(f.ahead.take(esc), false);
  assert.equal(esc.prevented, false);
  assert.equal(f.ahead.isArmed(), false);
  assert.equal(f.ahead.pending(), "");
});

test("the first key that reaches the live textarea replays the buffer before itself", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.take(key(f.root, "a"));
  f.ahead.take(key(f.root, "b"));
  f.doc.activeElement = f.ta;
  const ev = key(f.ta, "c");
  assert.equal(f.ahead.take(ev), false, "the key itself goes to the textarea");
  assert.equal(ev.prevented, false);
  assert.equal(f.ta.value, "ab", "buffer is already in, so c lands after it");
});

test("insertText with no keydown (IME, dictation) is kept, and text that reaches the textarea flushes first", () => {
  const f = setup();
  f.ahead.arm();
  const a = input(f.root, "insertText", "H");
  assert.equal(f.ahead.takeInput(a), true);
  assert.equal(a.prevented, true);
  f.ahead.takeInput(input(f.root, "insertText", "ello"));
  f.ahead.takeInput(input(f.root, "deleteContentBackward", null));
  assert.equal(f.ahead.pending(), "Hell");
  f.doc.activeElement = f.ta;
  const live = input(f.ta, "insertText", "o");
  assert.equal(f.ahead.takeInput(live), false);
  assert.equal(f.ta.value, "Hell");
});

test("beforeinput and textInput of one insertion count once; textInput alone (focus on the body) is kept", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.takeInput(input(f.root, "insertText", "l"));
  assert.equal(f.ahead.takeText(input(f.root, null, "l", "textInput")), true);
  f.ahead.takeInput(input(f.root, "insertText", "l"));
  f.ahead.takeText(input(f.root, null, "l", "textInput"));
  assert.equal(f.ahead.pending(), "ll", "two l's, not four");
  f.ahead.takeText(input(f.body, null, "ab", "textInput"));
  f.ahead.takeText(input(f.body, null, "c", "textInput"));
  assert.equal(f.ahead.pending(), "llabc");
});

test("a key in some other input cancels and is never captured", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.take(key(f.root, "a"));
  const other = { tagName: "INPUT" };
  f.doc.activeElement = other;
  const ev = key(other, "b");
  assert.equal(f.ahead.take(ev), false);
  assert.equal(ev.prevented, false);
  assert.equal(f.ahead.isArmed(), false);
  assert.equal(f.ahead.flush(f.ta), "", "nothing left to replay");
});

test("flush ignores anything but the card textarea, and the arm timer drops a buffer nobody claimed", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.take(key(f.root, "a"));
  assert.equal(f.ahead.flush(f.root), "");
  assert.equal(f.ahead.isArmed(), true);
  const t = f.timers.at(-1);
  assert.ok(t.on && t.ms > 0);
  t.fn();
  assert.equal(f.ahead.isArmed(), false);
  assert.equal(f.ahead.pending(), "");
});

test("without execCommand the replay uses setRangeText and dispatches input", () => {
  const f = setup({ execCommand: false });
  f.ahead.arm();
  f.ahead.take(key(f.root, "h"));
  f.ahead.take(key(f.root, "i"));
  f.ahead.flush(f.ta);
  assert.equal(f.ta.value, "hi");
  assert.equal(f.ta.inputs, 1);
});

test("the keyup of a swallowed key is swallowed too, and only once", () => {
  const f = setup();
  f.ahead.arm();
  f.ahead.take(key(f.root, "h", { code: "KeyH" }));
  const up = { type: "keyup", key: "h", code: "KeyH", stopImmediatePropagation() {}, stopPropagation() {} };
  assert.equal(f.ahead.takeUp(up), true);
  assert.equal(f.ahead.takeUp(up), false);
});

// ------------------------------------------------------------------ cards: Roam's view div
const blk = (uid, string, plexus, order) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": plexus }, ":block/children": [] });

test("a new card clicks Roam's view div as soon as it mounts, so the textarea is live without the hydrate wait", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    let frame = 0;
    let swappedAt = null;
    const host = {
      renderString(node, s) { node.textContent = s; },
      unmount() {},
      renderBlock(el) {
        // Roam mounts the view div first and swaps in a textarea only when that div is clicked.
        stub.window.requestAnimationFrame(() => {
          const view = doc.createElement("div");
          view.className = "rm-block__input rm-block__input--view";
          view.addEventListener("click", () => {
            if (swappedAt != null) return;
            swappedAt = frame;
            const ta = doc.createElement("textarea");
            ta.className = "rm-block-input";
            ta.value = "";
            view.replaceWith ? view.replaceWith(ta) : (view.remove(), el.append(ta));
            ta.focus();
          });
          el.append(view);
        });
      },
      blockString: () => "",
      pullTree: () => [],
      pullBoard: () => null,
      pageUid: (t) => `uid-${t}`,
      openBlock() {}, openPage() {}, watchPage() { return () => {}; },
      api: { ui: {} },
    };
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers: { idle() { return () => {}; }, later() { return () => {}; } }, bt: { available: () => false } });
    const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:T}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [blk("nt0000001", "", { ":x": 0, ":y": 0, ":w": 210, ":h": 80 }, 0)] });
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    const p = r.enterEdit(board.order[0]);
    let done = false;
    p.then(() => { done = true; });
    for (let i = 0; i < 60 && swappedAt == null; i += 1) {
      frame += 1;
      stub.flushFrames();
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    assert.notEqual(swappedAt, null, "the view div was clicked");
    assert.ok(swappedAt <= 3, `textarea live on frame ${swappedAt}, not after NOTE_INPUT_MS`);
    assert.equal(String(doc.activeElement?.tagName || "").toLowerCase(), "textarea");
    for (let i = 0; i < 80 && !done; i += 1) {
      frame += 1;
      stub.flushFrames();
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    assert.equal(done, true);
    r.dispose();
  } finally { restore(); }
});
