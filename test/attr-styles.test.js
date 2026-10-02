import assert from "node:assert/strict";
import test from "node:test";

import { attrLegend, parseAttrStyles, styleAttrLinks } from "../src/model/attr-styles.js";

const causes = {
  key: "A->B",
  from: "A",
  to: "B",
  kind: "attr",
  labels: ["Causes"],
  color: "teal",
  sources: [{ uid: "s", string: "Causes:: [[B]]" }],
};
const mentions = {
  key: "A->C",
  from: "A",
  to: "C",
  kind: "ref",
  labels: ["mentions"],
  color: "gray",
};

test("parseAttrStyles keeps palette colors and known dashes", () => {
  assert.deepEqual(parseAttrStyles(""), {});
  assert.deepEqual(parseAttrStyles("not json"), {});
  assert.deepEqual(parseAttrStyles(null), {});
  assert.deepEqual(parseAttrStyles([]), {});
  assert.deepEqual(parseAttrStyles({ Causes: { color: "nope", dash: "wavy" } }), {});
  assert.deepEqual(
    parseAttrStyles('{" Causes ":{"color":"red","dash":"solid"},"Owner":{"dash":"dotted"},"Skip":"x"}'),
    { Causes: { color: "red", dash: "solid" }, Owner: { dash: "dotted" } },
  );
});

test("styleAttrLinks applies the map and drops a hidden attribute without mutating the source", () => {
  const styled = styleAttrLinks([causes, mentions], { Causes: { color: "red", dash: "solid" } }, new Set());
  assert.equal(styled[0].color, "red");
  assert.equal(styled[0].dash, "solid");
  assert.equal(causes.color, "teal");
  assert.equal(causes.dash, undefined);
  assert.equal(styled[1], mentions);
  const hidden = styleAttrLinks([causes, mentions], {}, new Set(["Causes"]));
  assert.deepEqual(hidden.map((l) => l.key), ["A->C"]);
});

test("attrLegend lists each attribute once and marks a hidden name off", () => {
  const again = { ...causes, key: "A->D", color: "blue" };
  const rows = attrLegend([mentions, causes, again], new Set(["Causes"]), { Causes: { color: "red", dash: "solid" } });
  assert.deepEqual(rows, [{ name: "Causes", color: "red", dash: "solid", on: false }]);
});
