// PDF-2: highlight props, colour tag, area image macro, footer. No writes.
import assert from "node:assert/strict";
import test from "node:test";

import * as highlight from "../src/model/highlight.js";
import { highlightModel } from "../src/model/highlight.js";

const NAMES = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
const TEXT = "selected passage";
const TITLE = "Risk model.pdf";

function textModel() {
  return {
    type: "text",
    text: TEXT,
    image: false,
    natural: null,
    page: 2,
    color: "yellow",
    footer: `p. 2 · ${TITLE}`,
    note: "",
  };
}

test("a text highlight uses content text and #h/yellow without requiring quotation marks", () => {
  const model = highlightModel({
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":content": { ":text": TEXT },
        ":position": { ":boundingRect": { ":pageNumber": 1, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
        ":id": "hl01",
      },
      ":pdf-content-hash": "abc",
    },
    string: `${TEXT} #h/yellow`,
    pageTitle: TITLE,
  });
  assert.deepEqual(model, {
    type: "text",
    text: TEXT,
    image: false,
    natural: null,
    page: 1,
    color: "yellow",
    footer: `p. 1 · ${TITLE}`,
    note: "",
  });

  const preferred = highlightModel({
    props: {
      "pdf-highlight": {
        type: "text",
        content: { text: TEXT },
        position: { boundingRect: { pageNumber: 1 } },
      },
    },
    string: "other words #h/yellow",
    pageTitle: TITLE,
  });
  assert.equal(preferred.text, TEXT);
  assert.equal(preferred.color, "yellow");
  assert.equal(preferred.image, false);

  const unquoted = highlightModel({
    props: { "pdf-highlight": { type: "text", content: { text: "" } } },
    string: "selected passage #h/yellow",
    pageTitle: "",
  });
  assert.equal(unquoted.text, "selected passage");

  const quoted = highlightModel({
    props: { "pdf-highlight": { type: "text" } },
    string: "\"selected passage\" #h/yellow",
    pageTitle: "",
  });
  assert.equal(quoted.text, "\"selected passage\"");
});

test("an area highlight keeps the image macro and does not use image-id as the picture", () => {
  const macro = "![](https://example.test/figure.png)";
  const model = highlightModel({
    props: {
      ":pdf-highlight": {
        ":type": "area",
        ":content": { ":image-id": "zqJy0wsTc", ":text": "not the picture" },
        ":position": { ":boundingRect": { ":pageNumber": 2 } },
      },
      ":pdf-fingerprints": ["abc", null],
      ":image-size": { "https://example.test/figure.png": { ":width": 20, ":height": 10 } },
    },
    string: `${macro} #h/orange`,
    pageTitle: TITLE,
  });
  assert.deepEqual(model, {
    type: "area",
    text: macro,
    image: true,
    natural: { w: 20, h: 10 },
    page: 2,
    color: "orange",
    footer: `p. 2 · ${TITLE}`,
    note: "",
  });
  assert.equal(model.text.includes("zqJy0wsTc"), false);
  assert.equal(model.text.includes("not the picture"), false);
  assert.equal(model.image, true);

  const fromMacro = highlightModel({
    props: {
      "pdf-highlight": {
        type: "text",
        content: { text: "caption", "image-id": "zqJy0wsTc" },
      },
    },
    string: "see ![shot](https://example.test/a.png) #h/blue",
    pageTitle: "",
  });
  assert.equal(fromMacro.type, "area");
  assert.equal(fromMacro.image, true);
  assert.equal(fromMacro.text, "see ![shot](https://example.test/a.png)");
  assert.equal(fromMacro.color, "blue");
  assert.equal(fromMacro.text.includes("zqJy0wsTc"), false);

  const idOnly = highlightModel({
    props: { ":pdf-highlight": { ":type": "area", ":content": { ":image-id": "only-id" } } },
    string: "figure #h/pink",
    pageTitle: "P",
  });
  assert.equal(idOnly.type, "area");
  assert.equal(idOnly.image, true);
  assert.equal(idOnly.text, "figure");
  assert.notEqual(idOnly.image, "only-id");
});

test("missing pdf-highlight props return null", () => {
  assert.equal(highlightModel(), null);
  assert.equal(highlightModel(null), null);
  assert.equal(highlightModel({ string: "selected passage #h/yellow", pageTitle: TITLE }), null);
  assert.equal(highlightModel({ props: null, string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: undefined, string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: {}, string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: [], string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: { ":pdf-content-hash": "abc" }, string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: { plexus: { x: 1 } }, string: "selected passage #h/yellow" }), null);
  assert.equal(highlightModel({ props: { ":pdf-fingerprints": ["abc"] }, string: "![](https://example.test/a.png) #h/yellow" }), null);
});

test("colon keys and plain keys read the same highlight", () => {
  const string = `${TEXT} #h/yellow`;
  const expected = textModel();
  const colon = highlightModel({
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":content": { ":text": TEXT },
        ":position": { ":boundingRect": { ":pageNumber": 2 } },
      },
    },
    string,
    pageTitle: TITLE,
  });
  const plain = highlightModel({
    props: {
      "pdf-highlight": {
        type: "text",
        content: { text: TEXT },
        position: { boundingRect: { pageNumber: 2 } },
      },
    },
    string,
    pageTitle: TITLE,
  });
  const mixed = highlightModel({
    props: {
      "pdf-highlight": {
        ":type": "text",
        content: { ":text": TEXT },
        ":position": { boundingRect: { ":pageNumber": 2 } },
      },
    },
    string,
    pageTitle: TITLE,
  });
  assert.deepEqual(colon, expected);
  assert.deepEqual(plain, expected);
  assert.deepEqual(mixed, expected);
  assert.deepEqual(colon, plain);
});

test("an unknown tag is gray and every #h token is removed from the fallback body", () => {
  for (const name of NAMES) {
    const model = highlightModel({
      props: { ":pdf-highlight": { ":type": "text", ":content": { ":text": "x" } } },
      string: `x #h/${name}`,
      pageTitle: "T",
    });
    assert.equal(model.color, name);
  }
  const unknown = highlightModel({
    props: { "pdf-highlight": { type: "text", content: { text: "" }, position: { boundingRect: { pageNumber: 2 } } } },
    string: "#h/brown before #h/lime after",
    pageTitle: "  ",
  });
  assert.equal(unknown.color, "gray");
  assert.equal(unknown.text, "before after");
  assert.equal(unknown.footer, "p. 2");
  const grey = highlightModel({
    props: { "pdf-highlight": { type: "text", content: { text: "a" } } },
    string: "a #h/grey",
    pageTitle: "T",
  });
  assert.equal(grey.color, "gray");
});

test("page 2 footer is p. 2, a middle dot, and the trimmed page title", () => {
  const model = highlightModel({
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":content": { ":text": TEXT },
        ":position": { ":boundingRect": { ":pageNumber": 2 } },
      },
    },
    string: `${TEXT} #h/yellow`,
    pageTitle: "  Risk model.pdf  ",
  });
  assert.equal(model.page, 2);
  assert.equal(model.footer, "p. 2 · Risk model.pdf");

  const titleOnly = highlightModel({
    props: { "pdf-highlight": { type: "text", content: { text: TEXT }, position: { boundingRect: { pageNumber: "2" } } } },
    string: `${TEXT} #h/yellow`,
    pageTitle: "  Risk model.pdf  ",
  });
  assert.equal(titleOnly.page, null);
  assert.equal(titleOnly.footer, TITLE);

  const props = {
    ":pdf-highlight": {
      ":type": "text",
      ":content": { ":text": TEXT },
      ":position": { ":boundingRect": { ":pageNumber": 2 } },
    },
  };
  const snapshot = structuredClone(props);
  highlightModel({ props, string: `${TEXT} #h/yellow`, pageTitle: TITLE });
  assert.deepEqual(props, snapshot);
  assert.deepEqual(Object.keys(highlight).sort(), ["HIGHLIGHT_COLORS", "highlightModel", "highlightNote", "naturalSize", "noteActionPlan", "rewriteHighlightTag"]);
});
