// POL-4. Keyboard and names for the 3.x surfaces. Fake DOM. No live Roam.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSourceChip } from "../src/model/source-chip.js";
import { statusPalette } from "../src/model/status-tags.js";
import { paintPdfChipStrip } from "../src/view/pdf-chip-strip.js";
import { mountRegionCrop } from "../src/view/region-crop.js";
import { renderRegionCard } from "../src/view/region-card.js";
import { mountRegionMark } from "../src/view/region-mark.js";
import { openHaloPopover } from "../src/view/halo-pop.js";
import { openWhyPopover } from "../src/view/why-pop.js";
import { createTaskPopover, openStatusChooser } from "../src/view/task-popover.js";
import { createPanel } from "../src/view/panel.js";
import { createResurface } from "../src/view/resurface-panel.js";
import { mountTimeline } from "../src/view/timeline.js";
import { openViewDialog } from "../src/view/view-dialog.js";
import { createShortcutSheet } from "../src/view/shortcut-sheet.js";
import { findShortcut, SHEET_KEYS, SHORTCUTS } from "../src/view/shortcuts.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };

function rect(x, y, width, height) {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
}

function nameless(root) {
  const role = [...root.querySelectorAll("[role=button]")].filter((node) => !node.getAttribute("aria-label") && !String(node.textContent || "").trim());
  const buttons = [...root.querySelectorAll("button")].filter((node) => !(node.getAttribute("aria-label") || String(node.textContent || "").trim()));
  return { role, buttons };
}

test("region arrows nudge 1 px, Shift+arrows 10 px, Enter confirms, Esc cancels", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  root._rect = rect(10, 20, 800, 600);
  stub.document.body.append(root);
  const img = stub.document.createElement("img");
  img._rect = rect(40, 80, 200, 100);
  root.append(img);
  const seen = [];
  try {
    mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: (value) => seen.push(value),
      onCancel: () => seen.push("cancel"),
    });
    const layer = root.querySelector(".pxd-region-layer");
    assert.equal(layer.getAttribute("role"), "dialog");
    assert.equal(layer.getAttribute("aria-label"), "Mark region");
    assert.equal(layer.tabIndex, 0);
    const drag = (node, x0, y0, x1, y1) => {
      const at = (px, py) => ({ clientX: img._rect.x + img._rect.width * px, clientY: img._rect.y + img._rect.height * py, button: 0 });
      stub.dispatch(node, "pointerdown", at(x0, y0));
      stub.dispatch(stub.document, "pointerup", at(x1, y1));
    };
    drag(layer, 0.25, 0.3, 0.45, 0.55);
    const draft = root.querySelector(".pxd-region-draft");
    assert.equal(draft.style.left, "80px");
    stub.dispatch(layer, "keydown", { key: "ArrowRight" });
    assert.equal(draft.style.left, "81px");
    assert.equal(draft.style.width, "40px");
    stub.dispatch(root.querySelector(".pxd-region-caption"), "keydown", { key: "ArrowRight" });
    assert.equal(draft.style.left, "81px");
    stub.dispatch(layer, "keydown", { key: "Enter" });
    assert.deepEqual(seen, [{ frac: { rx: 0.255, ry: 0.3, rw: 0.2, rh: 0.25 }, caption: "" }]);

    seen.length = 0;
    mountRegionMark({ doc: stub.document, root, img, onConfirm: (value) => seen.push(value), onCancel: () => seen.push("cancel") });
    const again = root.querySelector(".pxd-region-layer");
    drag(again, 0.25, 0.3, 0.45, 0.55);
    stub.dispatch(again, "keydown", { key: "ArrowRight", shiftKey: true });
    assert.equal(root.querySelector(".pxd-region-draft").style.left, "90px");
    stub.dispatch(again, "keydown", { key: "Escape" });
    assert.deepEqual(seen, ["cancel"]);

    seen.length = 0;
    mountRegionMark({ doc: stub.document, root, img, onConfirm: (value) => seen.push(value) });
    const edge = root.querySelector(".pxd-region-layer");
    stub.dispatch(edge, "pointerdown", { clientX: img._rect.x + 180, clientY: img._rect.y + 20, button: 0 });
    stub.dispatch(stub.document, "pointerup", { clientX: img._rect.x + 200, clientY: img._rect.y + 40 });
    assert.equal(root.querySelector(".pxd-region-draft").style.left, "210px");
    stub.dispatch(edge, "keydown", { key: "ArrowRight" });
    assert.equal(root.querySelector(".pxd-region-draft").style.left, "210px");
  } finally {
    restore();
  }
});

test("status, halo, why, and task popovers take focus, move with arrows, and Esc returns to the opener", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  stub.window.RoamTaskStatusTags = { apiVersion: 1, statuses() { return []; }, setStatus() { return Promise.resolve({ status: "updated", didWrite: true }); } };
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  try {
    const anchor = stub.document.createElement("button");
    anchor.setAttribute("aria-label", "Status Active. Change status");
    anchor.textContent = "Active";
    root.append(anchor);
    anchor.focus();
    const picks = [];
    const chooser = openStatusChooser({
      doc: stub.document,
      anchor,
      palette: statusPalette(null),
      current: "Active",
      avoid: root,
      onPick: (name) => picks.push(name),
    });
    assert.equal(stub.document.activeElement.getAttribute("data-name"), "Active");
    stub.dispatch(stub.document.activeElement, "keydown", { key: "ArrowDown" });
    assert.equal(stub.document.activeElement.getAttribute("data-name"), "Waiting");
    stub.dispatch(chooser.el, "keydown", { key: "Escape" });
    assert.equal(root.querySelector(".pxd-status-chooser"), null);
    assert.equal(stub.document.activeElement, anchor);
    assert.deepEqual(picks, []);
    const space = openStatusChooser({
      doc: stub.document,
      anchor,
      palette: statusPalette(null),
      current: "Waiting",
      avoid: root,
      onPick: (name) => picks.push(name),
    });
    space.el.querySelector('[data-name="Waiting"]').focus();
    stub.dispatch(stub.document.activeElement, "keydown", { key: " " });
    assert.deepEqual(picks, ["Waiting"]);

    const haloOpener = stub.document.createElement("button");
    haloOpener.textContent = "Card";
    haloOpener.setAttribute("aria-label", "Open history");
    root.append(haloOpener);
    haloOpener.focus();
    const pulses = [];
    const halo = openHaloPopover({
      doc: stub.document,
      model: { with: [{ uid: "a", label: "Alpha" }, { uid: "b", label: "Beta" }] },
      onPulse: (uid) => pulses.push(uid),
    });
    assert.equal(halo.el.getAttribute("role"), "dialog");
    assert.equal(halo.el.getAttribute("aria-label"), "Card history");
    assert.equal(stub.document.activeElement.textContent, "Alpha");
    stub.dispatch(stub.document.activeElement, "keydown", { key: "ArrowUp" });
    assert.equal(stub.document.activeElement.textContent, "Alpha");
    stub.dispatch(stub.document.activeElement, "keydown", { key: "ArrowDown" });
    assert.equal(stub.document.activeElement.textContent, "Beta");
    stub.dispatch(stub.document.activeElement, "keydown", { key: "Enter" });
    assert.deepEqual(pulses, ["b"]);
    stub.dispatch(halo.el, "keydown", { key: "Escape" });
    assert.equal(halo.el.isConnected, false);
    assert.equal(stub.document.activeElement, haloOpener);
    haloOpener.focus();
    const kept = openHaloPopover({ doc: stub.document, model: { with: [{ uid: "a", label: "Alpha" }] } });
    const other = stub.document.createElement("button");
    other.setAttribute("aria-label", "Elsewhere");
    other.textContent = "Elsewhere";
    root.append(other);
    other.focus();
    kept.close();
    assert.equal(stub.document.activeElement, other);

    const whyOpener = stub.document.createElement("button");
    whyOpener.setAttribute("aria-label", "Edit why");
    whyOpener.textContent = "Why";
    root.append(whyOpener);
    whyOpener.focus();
    const cancelled = [];
    const saved = [];
    const why = openWhyPopover({
      doc: stub.document,
      label: "causes",
      why: "seal",
      onSave: (next) => saved.push(next),
      onCancel: () => cancelled.push(1),
    });
    const label = why.el.querySelector(".pxd-why__label");
    const note = why.el.querySelector(".pxd-why__note");
    assert.equal(stub.document.activeElement, label);
    stub.dispatch(label, "keydown", { key: "ArrowDown" });
    assert.equal(stub.document.activeElement, note);
    stub.dispatch(note, "keydown", { key: "Enter", shiftKey: true });
    assert.deepEqual(saved, []);
    stub.dispatch(why.el, "keydown", { key: "Escape" });
    assert.deepEqual(cancelled, [1]);
    assert.equal(stub.document.activeElement, whyOpener);

    const taskAnchor = stub.document.createElement("button");
    taskAnchor.setAttribute("aria-label", "Due");
    taskAnchor.textContent = "Due";
    root.append(taskAnchor);
    const bt = { available: () => true, modify: async () => ({ ok: true }), projects: async () => ["Alpha"] };
    const pop = createTaskPopover({ doc: stub.document, root, bt, today: () => new Date(2026, 9, 3) });
    assert.equal(pop.open("task1", "due", taskAnchor), true);
    const buttons = [...root.querySelectorAll(".pxd-task-pop__btn")];
    assert.equal(stub.document.activeElement, buttons[0]);
    stub.dispatch(buttons[0], "keydown", { key: "ArrowDown" });
    assert.equal(stub.document.activeElement, buttons[1]);
    const date = root.querySelector(".pxd-task-pop__input");
    date.focus();
    stub.dispatch(date, "keydown", { key: "ArrowDown" });
    assert.equal(stub.document.activeElement, date);
    assert.equal(pop.isOpen(), true);
    stub.dispatch(stub.document, "keydown", { key: "Escape" });
    assert.equal(pop.isOpen(), false);
    assert.equal(stub.document.activeElement, taskAnchor);
  } finally {
    restore();
  }
});

test("trail stops reorder with Alt+arrows and Enter walks from that stop", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const moves = [];
  const walks = [];
  try {
    const panel = createPanel({
      doc: stub.document,
      root,
      host: {},
      timers,
      on: {
        listTrails: () => [{
          uid: "trail1",
          name: "Lab",
          stops: [
            { uid: "s1", ref: "c1" },
            { uid: "s2", ref: "c2" },
            { uid: "s3", ref: "c3" },
            { uid: "s0", ref: "" },
          ],
        }],
        stopTitle: (ref) => ({ c1: "Alpha", c2: "Beta", c3: "Gamma" }[ref] || ""),
        moveStop: (uid, index) => moves.push([uid, index]),
        walkTrail: (uid, ref) => walks.push([uid, ref]),
      },
    });
    const before = stub.listenerCount();
    panel.open("trails");
    panel.refreshTrails();
    assert.equal(stub.listenerCount(), before);
    const labels = () => [...root.querySelectorAll(".pxd-trail__stop")].map((node) => node.getAttribute("aria-label"));
    assert.deepEqual(labels(), ["Alpha", "Beta", "Gamma", "Trail stop"]);
    const stops = () => [...root.querySelectorAll(".pxd-trail__stop")];
    assert.equal(stops()[0].tabIndex, 0);
    assert.equal(stops()[0].getAttribute("role"), "button");
    assert.equal(root.querySelector(".pxd-trail__walk").getAttribute("aria-label"), "Walk trail");
    stub.dispatch(stops()[0], "keydown", { key: "ArrowUp", altKey: true });
    assert.deepEqual(moves, []);
    const byLabel = (name) => stops().find((node) => node.getAttribute("aria-label") === name);
    stub.dispatch(stops()[0], "keydown", { key: "ArrowDown", altKey: true });
    assert.deepEqual(moves, [["s1", 1]]);
    assert.deepEqual(labels(), ["Beta", "Alpha", "Gamma", "Trail stop"]);
    stub.dispatch(byLabel("Alpha"), "keydown", { key: "ArrowDown", altKey: true });
    assert.deepEqual(moves, [["s1", 1], ["s1", 2]]);
    const last = stops()[stops().length - 1];
    stub.dispatch(last, "keydown", { key: "ArrowDown", altKey: true });
    assert.equal(moves.length, 2);
    const beta = stops().find((node) => node.getAttribute("aria-label") === "Beta");
    stub.dispatch(beta, "keydown", { key: "Enter" });
    assert.deepEqual(walks, [["trail1", "c2"]]);
    stub.dispatch(root.querySelector(".pxd-trail__name"), "keydown", { key: "Enter" });
    assert.deepEqual(walks, [["trail1", "c2"]]);
  } finally {
    restore();
  }
});

test("resurface, crops, PDF chips, region cards, and the timeline open from Enter", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const button = stub.document.createElement("button");
    button.className = "rm-xparser-default-plexus-resurface";
    button.textContent = "Resurface";
    button.setAttribute("aria-label", "Resurface");
    stub.document.body.append(button);
    const opens = [];
    const cardTime = new Date(2026, 9, 5, 1).getTime();
    const panel = createResurface({
      doc: stub.document,
      pageTitle: () => "October 12th, 2026",
      intervals: () => "7,30,90,365",
      rows: () => [{ uid: "card", cardUid: "card", boardUid: "board", title: "Aging", time: cardTime, rect: { x: 0, y: 0, w: 80, h: 40 } }],
      onOpen: (hit) => opens.push(hit),
    });
    panel.scan(stub.document.body);
    const box = stub.document.querySelector(".pxd-resurface");
    assert.equal(box.getAttribute("aria-label"), "Resurface");
    assert.equal(box.listeners.get("keydown").size, 1);
    panel.scan(stub.document.body);
    assert.equal(box.listeners.get("keydown").size, 1);
    const item = box.querySelector(".pxd-resurface__item");
    stub.dispatch(item, "keydown", { key: "Enter" });
    stub.dispatch(item, "keydown", { key: " " });
    assert.deepEqual(opens, [
      { boardUid: "board", cardUid: "card" },
      { boardUid: "board", cardUid: "card" },
    ]);

    const host = stub.document.createElement("div");
    const regionButton = stub.document.createElement("button");
    regionButton.textContent = "region";
    host.append(regionButton);
    stub.document.body.append(host);
    const crops = [];
    const crop = mountRegionCrop({
      doc: stub.document,
      button: regionButton,
      region: { caption: "Hamstring", f: [0.1, 0.2, 0.3, 0.4] },
      file: null,
      onOpen: (event) => crops.push(event.shiftKey),
    });
    assert.equal(crop.el.tabIndex, 0);
    assert.equal(crop.el.getAttribute("role"), "button");
    assert.equal(crop.el.getAttribute("aria-label"), "Hamstring");
    stub.dispatch(crop.el, "keydown", { key: "Enter" });
    assert.deepEqual(crops, [false]);

    const parent = stub.document.createElement("div");
    stub.document.body.append(parent);
    const pages = [];
    const later = [];
    const strip = paintPdfChipStrip(stub.document, parent, [{ page: 3, count: 2, uids: ["p3"] }], {
      later(fn, ms) { later.push(ms); fn(); },
      onPulse() { pages.push("pulse"); },
      onOpen(page) { pages.push(page); },
    });
    const chip = strip.querySelector("button");
    assert.equal(chip.getAttribute("aria-label"), "Page 3, 2");
    stub.dispatch(chip, "keydown", { key: "Enter" });
    assert.deepEqual(pages, [3]);
    assert.deepEqual(later, []);
    stub.dispatch(chip, "click");
    assert.deepEqual(later, [280]);
    assert.deepEqual(pages, [3, "pulse"]);

    const card = stub.document.createElement("div");
    stub.document.body.append(card);
    const drawn = [];
    renderRegionCard(stub.document, card, { caption: "Crop" }, { open: (arg) => drawn.push(arg) });
    renderRegionCard(stub.document, card, { caption: "Crop" }, { open: (arg) => drawn.push(arg) });
    const drawing = card.querySelector(".pxd-region-open");
    assert.equal(drawing.getAttribute("aria-label"), "Open drawing");
    assert.equal(card.querySelector(".pxd-region-sidebar").getAttribute("aria-label"), "Open in sidebar");
    stub.dispatch(drawing, "keydown", { key: "Enter" });
    assert.deepEqual(drawn, [{ sidebar: false }]);

    const days = [];
    const timeline = mountTimeline(parent, {
      doc: stub.document,
      rows: [{ cardUid: "cardA", pageTitle: "October 5th, 2026", pageUid: "10-05-2026", time: 1 }],
      onOpenDay: (uid) => days.push(uid),
    });
    assert.equal(timeline.el.getAttribute("aria-label"), "Timeline");
    stub.dispatch(timeline.el.querySelector(".pxd-timeline__open"), "keydown", { key: "Enter" });
    assert.deepEqual(days, ["10-05-2026"]);
    assert.equal(timeline.el.listeners.get("keydown").size, 1);
    timeline.dispose();
    assert.equal(timeline.el.listeners.get("keydown").size, 0);

    const source = [];
    const chipButton = buildSourceChip(stub.document, { pageUid: "page1", text: "Paper", title: "Paper" }, {
      onOpen: (uid) => source.push(uid),
    });
    parent.append(chipButton);
    stub.dispatch(chipButton, "keydown", { key: "Enter" });
    stub.dispatch(chipButton, "keydown", { key: " " });
    assert.deepEqual(source, ["page1"]);
  } finally {
    restore();
  }
});

test("the landmark field is labelled Glyph, Enter saves, and Esc returns to the opener", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const opener = stub.document.createElement("button");
    opener.setAttribute("aria-label", "Glyph");
    opener.textContent = "Glyph";
    stub.document.body.append(opener);
    opener.focus();
    const saved = [];
    const cancelled = [];
    const dialog = openViewDialog(stub.document, {
      caption: "*",
      showCopy: false,
      dialogLabel: "Landmark glyph",
      onSave: (result) => saved.push(result),
      onCancel: () => cancelled.push(1),
    });
    stub.document.body.append(dialog.el);
    assert.equal(dialog.el.querySelector("label").textContent, "Glyph");
    assert.equal(dialog.el.querySelector("input").getAttribute("aria-label"), "Landmark glyph");
    dialog.focus();
    assert.equal(stub.document.activeElement, dialog.el.querySelector("input"));
    stub.dispatch(dialog.el.querySelector("input"), "keydown", { key: "Enter" });
    assert.deepEqual(saved, [{ caption: "*", copy: false }]);

    const plain = openViewDialog(stub.document, { caption: "Corner", onSave: (result) => saved.push(result) });
    stub.document.body.append(plain.el);
    assert.equal(plain.el.querySelector("label").textContent, "Name");
    assert.equal(plain.el.querySelector("input").getAttribute("aria-label"), "View name");

    opener.focus();
    const esc = openViewDialog(stub.document, { caption: "Nope", onCancel: () => cancelled.push(1), onSave: () => saved.push("no") });
    stub.document.body.append(esc.el);
    esc.focus();
    stub.dispatch(esc.el, "keydown", { key: "Escape" });
    assert.equal(stub.document.activeElement, opener);
    assert.deepEqual(cancelled, [1]);
    assert.equal(saved.includes("no"), false);
  } finally {
    restore();
  }
});

test("the shortcut sheet lists the 3.x keys and findShortcut still owns arrows", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const opener = stub.document.createElement("button");
    opener.setAttribute("aria-label", "Board");
    opener.textContent = "Board";
    root.append(opener);
    opener.focus();
    const sheet = createShortcutSheet({ doc: stub.document, root, settings: { "task-tool": true } });
    sheet.open();
    const text = root.querySelector(".pxd-sheet").textContent;
    for (const row of SHORTCUTS) assert.equal(text.includes(row.keys), true, row.keys);
    for (const row of SHEET_KEYS) {
      assert.equal(text.includes(row.keys), true, row.keys);
      assert.equal(text.includes(row.label), true, row.label);
    }
    assert.equal(text.includes("Shift+V"), true);
    assert.equal(text.includes("Shift+T"), true);
    assert.equal(text.includes("K"), true);
    assert.equal(text.includes("⌘1"), true);
    assert.equal(text.includes("⌘9"), true);
    assert.equal(findShortcut({ key: "ArrowRight" }).action, "nudge");
    assert.equal(findShortcut({ key: "ArrowRight", shift: true }).action, "nudge");
    assert.equal(findShortcut({ key: "ArrowDown", alt: true }).action, "nearest");
    assert.equal(findShortcut({ key: "k" }, "normal", { "task-tool": false }), null);
    stub.dispatch(root.querySelector(".pxd-sheet__close"), "keydown", { key: "Escape" });
    assert.equal(root.querySelector(".pxd-sheet"), null);
    assert.equal(stub.document.activeElement, opener);

    const custom = createShortcutSheet({
      doc: stub.document,
      root,
      shortcuts: [{ group: "Custom", keys: "Z", label: "Only this" }],
    });
    custom.open();
    assert.equal(root.querySelector(".pxd-sheet").textContent.includes("Nudge region 1 px"), false);
    custom.close();
  } finally {
    restore();
  }
});

test("focus rings use --pxd-focus in light and dark, and named controls have no blank role=button", () => {
  const css = readFileSync(new URL("../src/css/focus.css", import.meta.url), "utf8");
  assert.match(css, /--pxd-focus:\s*#0d9488/);
  assert.match(css, /--pxd-focus:\s*#2dd4bf/);
  assert.match(css, /\.bp3-dark/);
  assert.match(css, /body\.bt-theme-dark/);
  assert.match(css, /\.rm-dark-theme/);
  assert.match(css, /body\.roam-body\.dark/);
  assert.match(css, /\.pxd-root--dark/);
  assert.match(css, /outline:\s*2px solid var\(--pxd-focus,\s*#0d9488\)/);
  assert.equal(/prefers-color-scheme/.test(css), false);
  assert.equal(/background/.test(css), false);
  const task = readFileSync(new URL("../src/css/task.css", import.meta.url), "utf8");
  assert.match(task, /\.pxd-task-pop__btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--pxd-focus/);
  const status = readFileSync(new URL("../src/css/status.css", import.meta.url), "utf8");
  assert.match(status, /\.pxd-status-chooser__row:focus-visible\s*\{[^}]*var\(--pxd-focus/);

  const stub = createDomStub();
  const restore = stub.install();
  stub.window.RoamTaskStatusTags = { apiVersion: 1, statuses() { return []; }, setStatus() {} };
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const anchor = stub.document.createElement("button");
    anchor.setAttribute("aria-label", "Status");
    anchor.textContent = "Status";
    root.append(anchor);
    openStatusChooser({ doc: stub.document, anchor, palette: statusPalette(null), avoid: root, onPick() {} });
    openHaloPopover({ doc: stub.document, model: { with: [{ uid: "a", label: "Alpha" }] } });
    const halo = stub.document.querySelector(".pxd-halo");
    const surfaces = [root, halo];
    for (const node of surfaces) {
      const blank = nameless(node);
      assert.deepEqual(blank.role.map((el) => el.className), []);
      assert.deepEqual(blank.buttons.map((el) => el.className), []);
    }
  } finally {
    restore();
  }
});

test("POL-4: a trail strip in Roam opens the stop and walks on Enter, with the latest stops after a repaint", async () => {
  const { renderTrailStrip } = await import("../src/model/trails.js");
  const { createDomStub } = await import("./fixtures/dom-stub.js");
  const stub = createDomStub();
  const doc = stub.document;
  const parent = doc.createElement("div");
  const seen = [];
  renderTrailStrip(doc, parent, [{ uid: "a", title: "A" }], { onStop: (s) => seen.push(`old:${s.uid}`) });
  renderTrailStrip(doc, parent, [{ uid: "b", title: "B" }, { uid: "c", title: "" }], { onStop: (s) => seen.push(s.uid), onWalk: () => seen.push("walk") });
  const stops = parent.querySelectorAll(".pxd-trail-strip__stop");
  assert.equal(stops[1].getAttribute("aria-label"), "Trail stop");
  const key = (target) => {
    const ev = { type: "keydown", key: "Enter", target, preventDefault() {}, stopPropagation() {} };
    for (const entry of parent.listeners?.get?.("keydown")?.values?.() || []) entry.fn(ev);
  };
  key(stops[1]);
  key(parent.querySelector(".pxd-trail-strip__walk"));
  assert.deepEqual(seen, ["c", "walk"]);
});
