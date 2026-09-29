import assert from "node:assert/strict";
import test from "node:test";
import {
  ARROWS, PALETTE, attrNameOf, classifyString, colorForLabel, edgeString, firstLine,
  mergePropsForWrite, normalizeEdge, normalizeItemLayout, parseBoardTitle, parseEdgeLabel,
  plainKeys, plainText, readPlexus, semanticRef, serializeEdge, serializeItemLayout,
} from "../src/model/schema.js";

test("plainKeys strips one leading colon at every depth and keeps values", () => {
  const out = plainKeys({ ":plexus": { ":x": -1.5, ":list": [{ ":a": 1 }, 2], ":flag": true, "::odd": 1 }, ":n": null });
  assert.deepEqual(out, { plexus: { x: -1.5, list: [{ a: 1 }, 2], flag: true, ":odd": 1 }, n: null });
  assert.equal(plainKeys(5), 5);
  assert.equal(plainKeys("s"), "s");
});

test("readPlexus reads pulled and plain props", () => {
  assert.deepEqual(readPlexus({ ":plexus": { ":v": 2 } }), { v: 2 });
  assert.deepEqual(readPlexus({ plexus: { v: 2 } }), { v: 2 });
  assert.equal(readPlexus({ ":other": 1 }), null);
  assert.equal(readPlexus(null), null);
  assert.equal(readPlexus({ plexus: "x" }), null);
});

test("mergePropsForWrite keeps rf-diagram and deletes plexus when null", () => {
  const props = { ":rf-diagram": { ":viewport": { ":x": 1, ":zoom": 0.5 } }, ":plexus": { ":v": 2 } };
  const merged = mergePropsForWrite(props, { v: 2, bg: "dots" });
  assert.deepEqual(merged, { "rf-diagram": { viewport: { x: 1, zoom: 0.5 } }, plexus: { v: 2, bg: "dots" } });
  const removed = mergePropsForWrite(props, null);
  assert.deepEqual(removed, { "rf-diagram": { viewport: { x: 1, zoom: 0.5 } } });
  assert.deepEqual(mergePropsForWrite(undefined, { v: 2 }), { plexus: { v: 2 } });
});

test("normalizeItemLayout / serializeItemLayout", () => {
  const n = normalizeItemLayout({ type: "bogus", x: 1, y: "2", w: NaN, color: "teal", fontSize: 20 });
  assert.equal(n.type, "card");
  assert.equal(n.x, 1);
  assert.equal(n.y, undefined);
  assert.equal(n.w, undefined);
  assert.equal(n.color, "teal");
  assert.equal(n.fontSize, undefined);
  assert.equal(normalizeItemLayout({ color: "mauve" }).color, undefined);
  assert.equal(normalizeItemLayout(null).type, "card");
  assert.deepEqual(serializeItemLayout({ type: "card", x: 1.26, y: -2.04, w: 280, h: 160 }), { x: 1.3, y: -2, w: 280, h: 160 });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 0, y: 0, w: 1, h: 1, color: "red", collapsed: true, fontSize: 24 }),
    { type: "section", x: 0, y: 0, w: 1, h: 1, color: "red", collapsed: true });
  assert.deepEqual(serializeItemLayout({ type: "text", x: 0, y: 0, fontSize: 32, collapsed: false }), { type: "text", x: 0, y: 0, fontSize: 32 });
});

test("normalizeEdge / serializeEdge", () => {
  const e = normalizeEdge({ type: "edge", from: "a", to: "b", dir: "bad", route: "elbow", weight: 5, fromSide: "left", color: "pink" });
  assert.deepEqual(e, { from: "a", to: "b", fromSide: "left", toSide: "auto", dir: "one", route: "elbow", dash: "solid", weight: 1, color: "pink" });
  assert.deepEqual(serializeEdge(e), { type: "edge", from: "a", to: "b", fromSide: "left", route: "elbow", color: "pink" });
  assert.deepEqual(serializeEdge(normalizeEdge({ from: "a", to: "b" })), { type: "edge", from: "a", to: "b" });
});

test("classifyString", () => {
  assert.deepEqual(classifyString("[[A]]"), { kind: "page", title: "A" });
  assert.deepEqual(classifyString(" #A "), { kind: "page", title: "A" });
  assert.deepEqual(classifyString("#[[A b]]"), { kind: "page", title: "A b" });
  assert.deepEqual(classifyString("[[a [[b]]]]"), { kind: "page", title: "a [[b]]" });
  assert.deepEqual(classifyString("((abcDEF123))"), { kind: "block", refUid: "abcDEF123" });
  assert.deepEqual(classifyString("{{[[diagram]]:X}}"), { kind: "board" });
  assert.deepEqual(classifyString("{{diagram}}"), { kind: "board" });
  assert.deepEqual(classifyString("![](https://x/y.png)"), { kind: "image" });
  assert.deepEqual(classifyString("[[A]] and more"), { kind: "note" });
  assert.deepEqual(classifyString("[[A]] [[B]]"), { kind: "note" });
  assert.deepEqual(classifyString(""), { kind: "note" });
  assert.deepEqual(classifyString(undefined), { kind: "note" });
});

test("parseBoardTitle", () => {
  assert.equal(parseBoardTitle("{{[[diagram]]:Hold for leak }}"), "Hold for leak");
  assert.equal(parseBoardTitle("{{[[diagram]]}}"), "");
  assert.equal(parseBoardTitle("{{diagram:Short}}"), "Short");
  assert.equal(parseBoardTitle("plain"), "");
});

test("plainText applies each markdown rule", () => {
  assert.equal(plainText("[[x]]"), "x");
  assert.equal(plainText("#[[x y]]"), "x y");
  assert.equal(plainText("a #tag b"), "a tag b");
  assert.equal(plainText("[t](http://u)"), "t");
  assert.equal(plainText("a ![alt](http://u) b"), "a b");
  assert.equal(plainText("see ((abc123def)) now"), "see now");
  assert.equal(plainText("**b** __i__ ^^h^^ ~~s~~ `c`"), "b i h s c");
  assert.equal(plainText("x {{[[diagram]]:X}} y"), "x y");
  assert.equal(plainText("Name:: [[B]]"), "Name:: B");
  assert.equal(plainText("[[a [[b]]]]"), "a b");
  assert.equal(plainText("a \n  b\t c"), "a b c");
  assert.equal(plainText("abcdefghij", 5), "abcd…");
  assert.equal(plainText(null), "");
});

test("firstLine", () => {
  assert.equal(firstLine("\n\n  **Hi** there\nsecond"), "Hi there");
  assert.equal(firstLine(""), "");
});

test("attrNameOf", () => {
  assert.equal(attrNameOf("Causes:: [[B]]"), "Causes");
  assert.equal(attrNameOf("Causes::"), "Causes");
  assert.equal(attrNameOf("a:b"), null);
  assert.equal(attrNameOf("no attr"), null);
  assert.equal(attrNameOf("x".repeat(61) + "::"), null);
  assert.equal(attrNameOf(null), null);
});

test("semanticRef", () => {
  assert.equal(semanticRef({ uid: "u", target: { kind: "page", title: "T" } }), "[[T]]");
  assert.equal(semanticRef({ uid: "u", target: { kind: "block", uid: "r" } }), "((r))");
  assert.equal(semanticRef({ uid: "u", target: { kind: "block", refUid: "r2" } }), "((r2))");
  assert.equal(semanticRef({ uid: "u", target: { kind: "self", uid: "u" } }), "((u))");
});

test("edgeString and parseEdgeLabel round-trip", () => {
  for (const dir of ["one", "two", "none"]) {
    for (const label of ["", "causes", "leads to the very end"]) {
      const s = edgeString({ srcRef: "[[A]]", dstRef: "((uid123456))", dir, label });
      assert.equal(s.includes(ARROWS[dir]), true);
      assert.equal(parseEdgeLabel(s, "[[A]]", "((uid123456))"), label, s);
    }
  }
  assert.equal(edgeString({ srcRef: "[[S]]", dstRef: "[[L]]", dir: "one", label: "causes" }), "[[S]] → causes → [[L]]");
  assert.equal(edgeString({ srcRef: "[[S]]", dstRef: "[[L]]" }), "[[S]] → [[L]]");
});

test("parseEdgeLabel falls back when the user rewrote the string", () => {
  assert.equal(parseEdgeLabel("blocks [[A]] → [[B]]", "[[A]]", "[[B]]"), "blocks");
  assert.equal(parseEdgeLabel("plain words", "[[A]]", "[[B]]"), "plain words");
  assert.equal(parseEdgeLabel("[[A]] → causes ↔ [[B]]", "[[A]]", "[[B]]"), "causes");
  assert.equal(parseEdgeLabel("anything → x", "", ""), "anything x");
});

test("colorForLabel", () => {
  for (const l of ["mentions", "", null, undefined]) assert.equal(colorForLabel(l), "gray");
  for (const l of ["Causes", "Requires", "a", "Leads to", "ünï"]) {
    const c = colorForLabel(l);
    assert.notEqual(c, "gray");
    assert.ok(PALETTE.includes(c));
    assert.equal(colorForLabel(l), c);
  }
});
