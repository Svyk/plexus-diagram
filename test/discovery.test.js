import assert from "node:assert/strict";
import test from "node:test";

import { diagramElForUid, isDiagramString } from "../src/discovery.js";

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
