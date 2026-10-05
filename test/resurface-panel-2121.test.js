import assert from "node:assert/strict";
import test from "node:test";

import { createResurface } from "../src/view/resurface-panel.js";
import { pageTitleToDate } from "../src/model/resurface.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("October 12 shows a card from October 5, and unload leaves the button", () => {
  assert.equal(pageTitleToDate("October 5th, 2026"), new Date(2026, 9, 5).getTime());
  const stub = createDomStub();
  const restore = stub.install();
  const opens = [];
  try {
    const button = stub.document.createElement("button");
    button.className = "rm-xparser-default-plexus-resurface";
    stub.document.body.append(button);
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
    assert.equal(box.querySelector(".pxd-resurface__tab").textContent, "1 week ago");
    panel.scan(box);
    panel.scan(stub.document.body);
    assert.equal(stub.document.querySelectorAll(".pxd-resurface").length, 1);
    stub.dispatch(box.querySelector(".pxd-resurface__item"), "click");
    assert.deepEqual(opens, [{ boardUid: "board", cardUid: "card" }]);
    panel.dispose();
    assert.equal(stub.document.querySelector(".pxd-resurface"), null);
    assert.equal(button.isConnected, true);

    const empty = createResurface({
      doc: stub.document,
      pageTitle: () => "Notes",
      rows: () => [],
    });
    delete button.dataset.pxdResurface;
    empty.scan(stub.document.body);
    assert.equal(stub.document.querySelector(".pxd-resurface__empty").textContent, "Nothing from a week, a month or a year ago.");
    empty.dispose();

    let listed = [];
    const late = createResurface({
      doc: stub.document,
      pageTitle: () => "October 12th, 2026",
      rows: () => listed,
    });
    delete button.dataset.pxdResurface;
    late.scan(stub.document.body);
    assert.equal(stub.document.querySelectorAll(".pxd-resurface").length, 1);
    assert.ok(stub.document.querySelector(".pxd-resurface__empty"));
    listed = [{ uid: "card", cardUid: "card", boardUid: "board", title: "Aging", time: cardTime }];
    late.scan(stub.document.body);
    assert.equal(stub.document.querySelectorAll(".pxd-resurface").length, 1);
    assert.equal(stub.document.querySelector(".pxd-resurface__tab").textContent, "1 week ago");
    late.dispose();
  } finally {
    restore();
  }
});
