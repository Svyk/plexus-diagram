import assert from "node:assert/strict";
import test from "node:test";
import { createDomStub } from "./fixtures/dom-stub.js";
import { openAddToBoard, recentBoardRows } from "../src/view/board-picker.js";

test("RG-7: recent boards are newest first", () => {
  const rows = recentBoardRows([
    { uid: "old", title: "Zed", edited: 1 },
    null,
    { uid: "new", title: "Amy", edited: 5, pageTitle: "Lab" },
    { title: "skip" },
  ]);
  assert.deepEqual(rows.map((row) => row.uid), ["new", "old"]);
});

test("RG-7: the picker lists recent boards, filters, and places the picked board", async () => {
  const dom = createDomStub();
  const picked = [];
  const picker = openAddToBoard({
    doc: dom.document,
    listBoards: async () => [
      { uid: "oldBOARD1", title: "Zed", edited: 1, pageTitle: "Notes" },
      { uid: "newBOARD2", title: "Amy", edited: 9, pageTitle: "Lab" },
    ],
    onPick: (board) => { picked.push(board.uid); return true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const names = () => [...dom.document.querySelectorAll(".pxd-addboard__name")].map((node) => node.textContent);
  assert.deepEqual(names(), ["Amy", "Zed"]);
  const filter = dom.document.querySelector(".pxd-addboard__filter");
  filter.value = "zed";
  filter.dispatchEvent({ type: "input" });
  assert.deepEqual(names(), ["Zed"]);
  filter.value = "";
  filter.dispatchEvent({ type: "input" });
  dom.document.querySelector(".pxd-addboard__row").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(picked, ["newBOARD2"]);
  assert.equal(dom.document.querySelector(".pxd-addboard"), null);
  picker.close();
});

test("RG-7: a failed place leaves the picker open, and Escape closes it", async () => {
  const dom = createDomStub();
  openAddToBoard({
    doc: dom.document,
    listBoards: () => [{ uid: "boardAAA1", title: "Fixture", edited: 2 }],
    onPick: () => false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  dom.document.querySelector(".pxd-addboard__row").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(dom.document.querySelector(".pxd-addboard"));
  dom.document.querySelector(".pxd-addboard").dispatchEvent({ type: "pxd-close" });
  assert.equal(dom.document.querySelector(".pxd-addboard"), null);
  assert.equal(dom.document.querySelector(".pxd-addboard-back"), null);
});
