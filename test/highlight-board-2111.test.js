// PDF-2: a block ref with highlight props is kind highlight. A direct card is not.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";
import { highlightModel } from "../src/model/highlight.js";

const TEXT = "selected passage";
const TITLE = "Risk model.pdf";

const textProps = {
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": TEXT },
    ":position": { ":boundingRect": { ":pageNumber": 1, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
  },
  ":pdf-content-hash": "abc",
};

const blk = (uid, string, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 40, ":y": 0 } },
  ":block/children": [],
});

test("((hl1)) with text props and #h/yellow is a highlight; an empty ref stays a block", () => {
  const resolved = `${TEXT} #h/yellow`;
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      blk("hlcard01", "((hl1))", 0),
      blk("empty001", "((plain1))", 1),
      blk("direct01", resolved, 2),
    ],
  }, {
    resolve(uid) {
      if (uid === "hl1") return resolved;
      if (uid === "plain1") return "just a note";
      return "";
    },
    propsOf(uid) {
      if (uid === "hl1") return { props: textProps, string: `${TEXT} #h/red`, pageTitle: TITLE };
      if (uid === "plain1") return { props: {}, string: resolved, pageTitle: TITLE };
      if (uid === "direct01") return { props: textProps, string: resolved, pageTitle: TITLE };
      return null;
    },
  });

  const expected = highlightModel({ props: textProps, string: resolved, pageTitle: TITLE });
  const hl = board.items.get("hlcard01");
  assert.equal(hl.kind, "highlight");
  assert.deepEqual(hl.target, { kind: "block", uid: "hl1" });
  assert.equal(hl.highlight.color, "yellow");
  assert.equal(hl.highlight.page, 1);
  assert.deepEqual(hl.highlight, expected);
  assert.equal(hl.title, expected.text);
  assert.notEqual(hl.color, "yellow");

  const empty = board.items.get("empty001");
  assert.equal(empty.kind, "block");
  assert.deepEqual(empty.target, { kind: "block", uid: "plain1" });
  assert.equal(empty.highlight, undefined);

  const direct = board.items.get("direct01");
  assert.notEqual(direct.kind, "highlight");
  assert.equal(direct.target.kind, "self");
  assert.equal(direct.highlight, undefined);
});
