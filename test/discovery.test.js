import assert from "node:assert/strict";
import test from "node:test";

import {
  diagramElForUid,
  diagramUidFromLocation,
  enhancedUidGuardCss,
  findDiagramUidFromEl,
  isDiagramString,
  routeLeftZoomedDiagram,
  waitForDiagramEl,
} from "../src/discovery.js";

function elWithClosest(closestMap) {
  return { closest: (selector) => closestMap[selector] ?? null };
}

test("isDiagramString accepts diagram macros", () => {
  assert.equal(isDiagramString("{{[[diagram]]}}"), true);
  assert.equal(isDiagramString("{{[[diagram]]:High APC}}"), true);
  assert.equal(isDiagramString("{{diagram}}"), true);
});

test("isDiagramString rejects other block types", () => {
  assert.equal(isDiagramString("{{[[table]]}}"), false);
  assert.equal(isDiagramString("```mermaid\ngraph TD\nA-->B\n```"), false);
  assert.equal(isDiagramString(""), false);
});
test("findDiagramUidFromEl parses dated zoomed outline ids", () => {
  const el = elWithClosest({
    '[id^="block-input-"]': { id: "block-input-6sW6RitOQegKal2aRqf6pKUspse2-body-outline-08-27-2026-1IIx5sG4L" },
  });
  assert.equal(findDiagramUidFromEl(el), "1IIx5sG4L");
});

test("findDiagramUidFromEl parses non-dated outline ids", () => {
  const el = elWithClosest({
    '[id^="block-input-"]': { id: "block-input-abc-body-outline-1IIx5sG4L" },
  });
  assert.equal(findDiagramUidFromEl(el), "1IIx5sG4L");
});

test("findDiagramUidFromEl rejects date prefixes from the loose outline pattern", () => {
  const el = elWithClosest({
    '[id^="block-input-"]': { id: "block-input-abc-body-outline-08-27-2026" },
  });
  assert.equal(findDiagramUidFromEl(el), null);
});

test("findDiagramUidFromEl prefers block-ref data-uid over outline ids", () => {
  const el = elWithClosest({
    ".rm-block-ref[data-uid]": { dataset: { uid: "refuid123" } },
    '[id^="block-input-"]': { id: "block-input-abc-body-outline-otheruid" },
  });
  assert.equal(findDiagramUidFromEl(el), "refuid123");
});

test("findDiagramUidFromEl falls back to the zoomed page uid from the location hash", () => {
  const previousLocation = globalThis.location;
  globalThis.location = { hash: "#/app/Svy/page/1IIx5sG4L" };
  const el = elWithClosest({ ".rm-zoom-block-wrapper": {} });
  try {
    assert.equal(findDiagramUidFromEl(el), "1IIx5sG4L");
  } finally {
    globalThis.location = previousLocation;
  }
});

test("diagramUidFromLocation reads the page uid from roam hashes", () => {
  assert.equal(diagramUidFromLocation("#/app/Svy/page/1IIx5sG4L"), "1IIx5sG4L");
  assert.equal(diagramUidFromLocation("#/app/Svy"), null);
  assert.equal(diagramUidFromLocation(""), null);
});

test("routeLeftZoomedDiagram is true when house/daily tab leaves the zoomed diagram page", () => {
  assert.equal(routeLeftZoomedDiagram("1IIx5sG4L", "#/app/Svy/page/1IIx5sG4L"), false);
  assert.equal(routeLeftZoomedDiagram("1IIx5sG4L", "#/app/Svy/page/08-27-2026"), true);
  assert.equal(routeLeftZoomedDiagram("1IIx5sG4L", "#/app/Svy"), true);
  assert.equal(routeLeftZoomedDiagram("1IIx5sG4L", ""), true);
});

test("enhancedUidGuardCss hides native canvas, title panel, and react-flow with display:none", () => {
  const css = enhancedUidGuardCss(["1IIx5sG4L"]);
  assert.match(css, /display: none !important/);
  assert.match(css, /\.rm-diagram-title-panel/);
  assert.match(css, /\.react-flow/);
  assert.match(css, /\[id\$="1IIx5sG4L"\]/);
});

test("diagramElForUid queries id suffix, data-uid, and block-ref hosts", () => {
  const selectors = [];
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  globalThis.CSS = { escape: (value) => String(value) };
  globalThis.document = {
    querySelector(selector) {
      selectors.push(selector);
      if (selector.includes('[id$="abc123"]')) return { host: "id-suffix" };
      if (selector.includes('[data-uid="abc123"]')) return { host: "data-uid" };
      if (selector.includes('.rm-block-ref[data-uid="abc123"]')) return { host: "block-ref" };
      return null;
    },
  };
  try {
    assert.deepEqual(diagramElForUid("abc123"), { host: "id-suffix" });
    assert.match(selectors[0], /\[id\$="abc123"\]/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("waitForDiagramEl resolves immediately when the canvas exists", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const node = { className: "rm-diagram" };
  globalThis.CSS = { escape: (value) => String(value) };
  globalThis.document = {
    querySelector(selector) {
      return selector.includes('[id$="abc123"]') ? node : null;
    },
  };
  try {
    assert.equal(await waitForDiagramEl("abc123", { timeout: 50, root: globalThis.document }), node);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("waitForDiagramEl times out when the canvas never remounts", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  globalThis.CSS = { escape: (value) => String(value) };
  globalThis.document = { querySelector: () => null };
  try {
    assert.equal(await waitForDiagramEl("missing", { timeout: 30, root: globalThis.document }), null);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});
