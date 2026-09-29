import test from "node:test";
import assert from "node:assert/strict";
import { linksQuery, reduceLinks, filterLinks, coveredBy } from "../src/model/links.js";
import { colorForLabel } from "../src/model/schema.js";

test("linksQuery has the clauses and find vars", () => {
  const q = linksQuery();
  assert.match(q, /:find \?a \?b \?su \?ss/);
  assert.match(q, /:in \$ \?board \[\?a \.\.\.\] \[\?b \.\.\.\]/);
  assert.ok(q.includes("(or "));
  assert.ok(q.includes("(not [?src :block/parents ?board])"));
  assert.ok(q.includes("[?src :block/refs ?b]"));
  assert.ok(q.includes("[(not= ?src ?board)]"));
});

const map = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

test("reduceLinks labels: own string, bare parent, mentions fallback", () => {
  const eidToItems = map({ 1: ["A"], 2: ["B"] });
  const links = reduceLinks(
    [
      [1, 2, "s1", "Causes:: [[B]]"],
      [1, 2, "s2", "see [[B]]"],
      [1, 2, "s3", "[[B]]"],
    ],
    { eidToItems, parentStrings: new Map([["s3", "Owner::"], ["s2", "just text"]]) },
  );
  assert.equal(links.length, 1);
  const l = links[0];
  assert.equal(l.key, "A->B");
  assert.equal(l.from, "A");
  assert.equal(l.to, "B");
  assert.equal(l.kind, "attr");
  assert.deepEqual(l.labels, ["Causes", "Owner", "mentions"]);
  assert.equal(l.color, colorForLabel("Causes"));
  assert.equal(l.sources.length, 3);
  assert.deepEqual(l.sources[0], { uid: "s1", string: "Causes:: [[B]]" });
});

test("reduceLinks bare parent alone, and parent with content is ignored", () => {
  const eidToItems = map({ 1: ["A"], 2: ["B"] });
  const [l] = reduceLinks([[1, 2, "s", "[[B]]"]], { eidToItems, parentStrings: new Map([["s", "Depends on::"]]) });
  assert.deepEqual(l.labels, ["Depends on"]);
  assert.equal(l.kind, "attr");
  const [m] = reduceLinks([[1, 2, "s", "[[B]]"]], { eidToItems, parentStrings: new Map([["s", "Depends on:: x"]]) });
  assert.deepEqual(m.labels, ["mentions"]);
  assert.equal(m.kind, "ref");
  assert.equal(m.color, "gray");
});

test("reduceLinks attr labels first regardless of row order", () => {
  const eidToItems = map({ 1: ["A"], 2: ["B"] });
  const [l] = reduceLinks(
    [[1, 2, "s1", "plain [[B]]"], [1, 2, "s2", "Rel:: [[B]]"]],
    { eidToItems },
  );
  assert.deepEqual(l.labels, ["Rel", "mentions"]);
  assert.equal(l.color, colorForLabel("Rel"));
});

test("reduceLinks collapses duplicates", () => {
  const eidToItems = map({ 1: ["A"], 2: ["B"] });
  const rows = [[1, 2, "s1", "Rel:: [[B]]"], [1, 2, "s1", "Rel:: [[B]]"], [1, 2, "s2", "Rel:: [[B]] x"]];
  const links = reduceLinks(rows, { eidToItems });
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].labels, ["Rel"]);
  assert.deepEqual(links[0].sources.map((s) => s.uid), ["s1", "s2"]);
});

test("reduceLinks eid mapping to two items yields links per pair; self pairs dropped", () => {
  const eidToItems = map({ 1: ["A1", "A2"], 2: ["B", "A1"] });
  const links = reduceLinks([[1, 2, "s", "x [[y]]"]], { eidToItems });
  assert.deepEqual(links.map((l) => l.key).sort(), ["A1->B", "A2->A1", "A2->B"]);
  assert.ok(!links.some((l) => l.from === l.to));
});

test("reduceLinks skips unmapped eids and caps sources at 20", () => {
  const eidToItems = map({ 1: ["A"], 2: ["B"] });
  assert.deepEqual(reduceLinks([[1, 9, "s", "x"], [8, 2, "s", "x"]], { eidToItems }), []);
  const rows = Array.from({ length: 30 }, (_, i) => [1, 2, `u${i}`, `t${i}`]);
  const [l] = reduceLinks(rows, { eidToItems });
  assert.equal(l.sources.length, 20);
  assert.equal(l.sources[19].uid, "u19");
});

test("filterLinks modes", () => {
  const links = [{ key: "a", kind: "attr" }, { key: "b", kind: "ref" }];
  assert.deepEqual(filterLinks(links, "off"), []);
  assert.deepEqual(filterLinks(links, "attributes"), [links[0]]);
  assert.deepEqual(filterLinks(links, "all"), links);
});

test("coveredBy hides links in both directions and returns covered edge uids", () => {
  const links = [
    { key: "A->B", from: "A", to: "B" },
    { key: "C->D", from: "C", to: "D" },
    { key: "E->F", from: "E", to: "F" },
  ];
  const board = {
    edges: new Map([
      ["e1", { from: "A", to: "B" }],
      ["e2", { from: "D", to: "C" }],
      ["e3", { from: "X", to: "Y" }],
    ]),
  };
  const { visible, coveredEdges } = coveredBy(links, board);
  assert.deepEqual(visible.map((l) => l.key), ["E->F"]);
  assert.deepEqual([...coveredEdges].sort(), ["e1", "e2"]);
  const none = coveredBy(links, { edges: new Map() });
  assert.equal(none.visible.length, 3);
  assert.equal(none.coveredEdges.size, 0);
});
