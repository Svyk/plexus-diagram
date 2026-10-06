import assert from "node:assert/strict";
import test from "node:test";

import { statusPalette } from "../src/model/status-tags.js";
import { applyStatusPicks, buildMenu, flattenMenu, STATUS_WRITE_CAP } from "../src/view/menu-model.js";
import { openStatusChooser } from "../src/view/task-popover.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const byId = (items, id) => flattenMenu(items).find((item) => item.id === id);

function arm(stub) {
  stub.window.RoamTaskStatusTags = {
    apiVersion: 1,
    statuses() { return []; },
    setStatus() { return Promise.resolve({ status: "updated", didWrite: true }); },
  };
}

function mount(stub) {
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const anchor = stub.document.createElement("span");
  anchor.className = "pxd-task-check";
  anchor._rect = { left: 40, top: 40, width: 16, height: 16, right: 56, bottom: 56, x: 40, y: 40 };
  root.append(anchor);
  return { root, anchor };
}

const tags = () => ({ available: () => true, palette: () => statusPalette(null) });

test("the chooser calls onPick once per row, including Enter then click", () => {
  const stub = createDomStub();
  arm(stub);
  const { root, anchor } = mount(stub);
  const picks = [];
  const opened = openStatusChooser({
    doc: stub.document,
    anchor,
    palette: statusPalette(null),
    current: "Active",
    avoid: root,
    onPick: (name) => picks.push(name),
    onRemove: () => picks.push("remove"),
  });
  assert.ok(opened?.el);
  assert.equal(stub.document.activeElement?.getAttribute?.("data-name"), "Active");
  const waiting = opened.el.querySelector('[data-name="Waiting"]');
  waiting.dispatchEvent({ type: "click" });
  waiting.dispatchEvent({ type: "click" });
  assert.deepEqual(picks, ["Waiting"]);
  assert.equal(root.querySelector(".pxd-status-chooser"), null);

  const again = openStatusChooser({
    doc: stub.document,
    anchor,
    palette: statusPalette(null),
    current: "Waiting",
    avoid: root,
    onPick: (name) => picks.push(name),
  });
  const row = again.el.querySelector('[data-name="Waiting"]');
  row.focus();
  row.dispatchEvent({ type: "keydown", key: "Enter" });
  row.dispatchEvent({ type: "click" });
  assert.deepEqual(picks, ["Waiting", "Waiting"]);
});

test("Remove status calls onRemove(null) and not onPick; Escape closes without a pick", () => {
  const stub = createDomStub();
  arm(stub);
  const { root, anchor } = mount(stub);
  const picks = [];
  const removed = [];
  const opened = openStatusChooser({
    doc: stub.document,
    anchor,
    palette: statusPalette(null),
    current: "Alert",
    avoid: root,
    onPick: (name) => picks.push(name),
    onRemove: (value) => removed.push(value),
  });
  opened.el.querySelector("[data-remove]").dispatchEvent({ type: "click" });
  assert.deepEqual(removed, [null]);
  assert.deepEqual(picks, []);

  const again = openStatusChooser({
    doc: stub.document,
    anchor,
    palette: statusPalette(null),
    avoid: root,
    onPick: (name) => picks.push(name),
    onRemove: (value) => removed.push(value),
  });
  again.el.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(root.querySelector(".pxd-status-chooser"), null);
  assert.deepEqual(picks, []);
  assert.deepEqual(removed, [null]);
});

test("the chooser stays closed without the API and while a Better Tasks dialog is open", () => {
  const stub = createDomStub();
  const { root, anchor } = mount(stub);
  assert.equal(openStatusChooser({ doc: stub.document, anchor, palette: statusPalette(null), avoid: root, onPick() {} }), null);
  assert.equal(root.querySelector(".pxd-status-chooser"), null);
  arm(stub);
  const dialog = stub.document.createElement("div");
  dialog.className = "bp3-dialog";
  stub.document.body.append(dialog);
  assert.equal(openStatusChooser({ doc: stub.document, anchor, palette: statusPalette(null), avoid: root, onPick() {} }), null);
  assert.equal(root.querySelector(".pxd-status-chooser"), null);
});

test("pointerdown and mousedown on the chooser do not bubble to the document", () => {
  const stub = createDomStub();
  arm(stub);
  const { root, anchor } = mount(stub);
  const seen = [];
  stub.document.addEventListener("pointerdown", () => seen.push("pointerdown"));
  stub.document.addEventListener("mousedown", () => seen.push("mousedown"));
  const opened = openStatusChooser({
    doc: stub.document,
    anchor,
    palette: statusPalette(null),
    avoid: root,
    onPick() {},
  });
  const row = opened.el.querySelector("button");
  row.dispatchEvent({ type: "pointerdown" });
  row.dispatchEvent({ type: "mousedown" });
  assert.deepEqual(seen, []);
  assert.ok(root.querySelector(".pxd-status-chooser"));
});

test("Status ▸ is hidden unless statusTags.available() is true", () => {
  assert.equal(byId(buildMenu("card", {}), "status"), undefined);
  assert.equal(byId(buildMenu("card", { statusTags: { available: () => false, palette: statusPalette(null) } }), "status"), undefined);
  assert.equal(byId(buildMenu("multi", { count: 3 }), "status"), undefined);
  const card = buildMenu("card", { statusTags: tags(), status: "Waiting" });
  const item = byId(card, "status");
  assert.equal(item.label, "Status ▸");
  assert.equal(byId(card, "status:Waiting").checked, true);
  assert.equal(byId(card, "status:Active").checked, undefined);
  assert.equal(byId(card, "status:Waiting").glyph, "waiting");
  assert.equal(byId(card, "status:remove").label, "Remove status");
  const ids = card.filter((row) => !row.separator).map((row) => row.id);
  assert.ok(ids.indexOf("status") === ids.indexOf("color") + 1);
  const multi = buildMenu("multi", { count: 3, statusTags: tags(), status: "Alert" });
  assert.equal(byId(multi, "status").label, "Status ▸");
  assert.equal(byId(multi, "status:Alert").checked, true);
  assert.equal(byId(multi, "status:remove").label, "Remove status");
  assert.equal(byId(buildMenu("board-menu", { statusTags: tags() }), "status"), undefined);
});

test("applyStatusPicks writes at most 45 cards, one at a time, and keeps going after a rejection", async () => {
  assert.equal(STATUS_WRITE_CAP, 45);
  const uids = Array.from({ length: 50 }, (_, i) => `u${i}`);
  let active = 0;
  let max = 0;
  const calls = [];
  const progress = [];
  await applyStatusPicks(uids, "Waiting", async (uid, name) => {
    active += 1;
    max = Math.max(max, active);
    calls.push({ uid, name });
    await Promise.resolve();
    active -= 1;
    return { status: "updated", didWrite: true };
  }, (event) => progress.push(event));
  assert.equal(max, 1);
  assert.equal(calls.length, 45);
  assert.equal(calls[0].uid, "u0");
  assert.equal(calls[44].uid, "u44");
  assert.equal(calls[0].name, "Waiting");
  assert.equal(progress.at(-1).done, 45);
  assert.equal(progress.at(-1).total, 45);
  assert.equal(progress.at(-1).name, "Waiting");

  const toasts = [];
  const seen = [];
  const result = await applyStatusPicks(["a", "b", "c"], null, async (uid, name) => {
    seen.push({ uid, name });
    if (uid === "b") return { status: "rejected", reason: "locked" };
    return { status: "updated", didWrite: true };
  }, null, (toast) => toasts.push(toast));
  assert.deepEqual(seen, [{ uid: "a", name: null }, { uid: "b", name: null }, { uid: "c", name: null }]);
  assert.equal(result.applied, 3);
  assert.deepEqual(result.rejected, [{ uid: "b", reason: "locked" }]);
  assert.deepEqual(toasts, [{ message: "locked" }]);
});
