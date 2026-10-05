import assert from "node:assert/strict";
import test from "node:test";

import { mountContextsDrawer } from "../src/view/contexts-drawer.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function row(uid, year, crumb) {
  return { uid, time: new Date(year, 5, 15).getTime(), crumb, snippet: crumb };
}

test("three years group newest first, shift-click asks for the sidebar, and 250 refs cap at 200", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const opens = [];
  const queued = [];
  try {
    const parent = stub.document.createElement("div");
    stub.document.body.append(parent);
    const rows = [
      row("a", 2024, "Old page"),
      row("b", 2026, "New page"),
      row("c", 2026, "Also new"),
    ];
    const handle = mountContextsDrawer({
      doc: stub.document,
      parent,
      rows,
      onOpen: (uid, opts) => opens.push([uid, opts.sidebar]),
      schedule: (fn) => queued.push(fn),
    });
    const years = [...handle.el.querySelectorAll(".pxd-contexts__year")].map((node) => node.textContent);
    assert.deepEqual(years, ["2026", "2024"]);
    const buttons = [...handle.el.querySelectorAll(".pxd-contexts__row")];
    stub.dispatch(buttons[0], "click", { shiftKey: true });
    assert.deepEqual(opens, [[buttons[0].getAttribute("data-uid"), true]]);
    handle.close();

    const many = [];
    for (let i = 0; i < 250; i += 1) many.push(row(`r${i}`, 2026, `row ${i}`));
    const big = mountContextsDrawer({
      doc: stub.document,
      parent,
      rows: many,
      schedule: (fn) => queued.push(fn),
    });
    assert.match(big.el.querySelector(".pxd-contexts__cap").textContent, /Showing 200 of 250/);
    assert.equal(big.el.querySelectorAll(".pxd-contexts__row").length, 25);
    assert.ok(big.el.querySelector(".pxd-contexts__filter"));
    while (queued.length) queued.shift()();
    assert.equal(big.el.querySelectorAll(".pxd-contexts__row").length, 200);
    big.close();
  } finally {
    restore();
  }
});
