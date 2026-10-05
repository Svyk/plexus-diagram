import assert from "node:assert/strict";
import test from "node:test";

import { openHaloPopover } from "../src/view/halo-pop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const OCT_4 = Date.UTC(2026, 9, 4, 15, 0, 0);

function mount(model, pageExists) {
  const stub = createDomStub();
  const restore = stub.install();
  const calls = [];
  const unmounted = [];
  const pulses = [];
  const handle = openHaloPopover({
    doc: stub.document,
    anchor: { left: 20, top: 20, right: 50, bottom: 44, width: 30, height: 24 },
    model,
    pageExists,
    renderString(el, string) {
      calls.push(string);
      const ref = stub.document.createElement("span");
      ref.className = "rm-page-ref";
      ref.setAttribute("data-link-uid", "day1");
      ref.textContent = string;
      el.append(ref);
    },
    unmount(el) { unmounted.push(el); },
    onPulse(uid) { pulses.push(uid); },
  });
  return { stub, restore, handle, calls, unmounted, pulses };
}

test("a missing daily page stays plain text, and an existing one is a page ref", () => {
  const model = {
    created: OCT_4,
    board: "Board X",
    section: "Section Y",
    userName: "",
    with: [{ uid: "a", label: "card A" }],
    refTimes: [OCT_4, OCT_4 + 1000],
    boards: 2,
  };
  const missing = mount(model, () => false);
  try {
    const pop = missing.handle.el;
    assert.equal(pop.classList.contains("pxd-root"), true);
    assert.equal(pop.style.position, "fixed");
    assert.equal(pop.parentElement, missing.stub.document.body);
    assert.match(pop.querySelector(".pxd-halo__head").textContent, /Made October 4th, 2026 on Board X › Section Y/);
    assert.equal(pop.querySelector(".pxd-halo__head").textContent.includes(" by "), false);
    assert.equal(missing.calls.length, 0);
    assert.equal(pop.querySelectorAll(".pxd-halo__spark rect").length, 12);
    assert.equal(pop.querySelector(".pxd-halo__spark").getAttribute("data-sum"), "2");
    assert.equal(pop.querySelector(".pxd-halo__boards").textContent, "On 2 boards");
    const event = missing.stub.dispatch(pop.querySelector(".pxd-halo__head"), "pointerdown");
    assert.equal(event.propagationStopped, true);
  } finally {
    missing.handle.close();
    missing.restore();
  }

  const present = mount(model, () => true);
  try {
    const pop = present.handle.el;
    assert.deepEqual(present.calls, ["[[October 4th, 2026]]", "[[October 4th, 2026]]", "[[October 4th, 2026]]"]);
    const ref = pop.querySelector(".rm-page-ref");
    assert.equal(ref.parentElement.classList.contains("pxd-halo__link"), true);
    assert.equal(ref.parentElement.classList.contains("pxd-root"), false);
    const event = present.stub.dispatch(ref, "pointerdown");
    assert.equal(event.propagationStopped, false);
    present.stub.dispatch(pop.querySelector(".pxd-halo__company"), "click");
    assert.deepEqual(present.pulses, ["a"]);
    present.handle.close();
    assert.equal(present.unmounted.length, 3);
    assert.equal(pop.isConnected, false);
  } finally {
    present.restore();
  }
});
