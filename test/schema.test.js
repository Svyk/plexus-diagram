import assert from "node:assert/strict";
import test from "node:test";
import {
  ARROWS, PALETTE, attrNameOf, classifyString, colorForLabel, edgeString, firstLine,
  cardLook, lookForNewString,
  mergePropsForWrite, normalizeEdge, normalizeItemLayout, parseBoardTitle, parseEdgeLabel,
  plainKeys, plainText, readPlexus, semanticRef, serializeEdge, serializeItemLayout,
  BOARD_PATTERNS, BOARD_TONES, FIT_PAD, dailyPageTitle,
  NATIVE_SWATCHES, hexColor, shadeHex, styleColor, normalizeSectionDefaults, cssColor,
  DEFAULT_BOARD_CARD, UNTITLED_BOARD, boardString, isUntitledBoard, setBoardTitle, withBoardMarker,
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
  assert.equal(n.fontSize, 20);
  assert.equal(normalizeItemLayout({ color: "mauve" }).color, undefined);
  assert.equal(normalizeItemLayout(null).type, "card");
  assert.deepEqual(serializeItemLayout({ type: "card", x: 1.26, y: -2.04, w: 280, h: 160 }), { x: 1.3, y: -2, w: 280, h: 160 });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 0, y: 0, w: 1, h: 1, color: "red", collapsed: true, fontSize: 24 }),
    { type: "section", x: 0, y: 0, w: 1, h: 1, color: "red", collapsed: true });
  assert.deepEqual(serializeItemLayout({ type: "text", x: 0, y: 0, fontSize: 32, collapsed: false }), { type: "text", x: 0, y: 0, fontSize: 32 });
  assert.equal(normalizeItemLayout({ look: "block" }).look, "block");
  assert.equal(normalizeItemLayout({ look: "card" }).look, "card");
  assert.equal(normalizeItemLayout({ look: "tile" }).look, undefined);
  assert.deepEqual(serializeItemLayout({ x: 1, look: "block" }), { x: 1, look: "block" });
  assert.deepEqual(serializeItemLayout({ x: 1, look: "nope" }), { x: 1 });
  assert.equal(cardLook("note"), "block");
  assert.equal(cardLook("page"), "card");
  assert.equal(cardLook("note", "card"), "card");
  assert.equal(lookForNewString("alpha", "block"), "block");
  assert.equal(lookForNewString("alpha", "card"), "card");
  assert.equal(lookForNewString("[[Page]]", "block"), undefined);
  assert.equal(lookForNewString("((abc))", "card"), undefined);
  assert.equal(normalizeItemLayout({ type: "text", look: "sticky" }).look, "sticky");
  assert.equal(serializeItemLayout({ type: "text", x: 1, look: "sticky", w: 200, h: 200, color: "yellow" }).look, "sticky");
  assert.equal(normalizeItemLayout({ type: "card", look: "sticky" }).look, undefined);
  assert.equal(serializeItemLayout({ type: "card", x: 1, look: "sticky" }).look, undefined);
  assert.equal(normalizeItemLayout({ type: "text", look: "note" }).look, undefined);
  const lane = normalizeItemLayout({ type: "section", look: "lane", axis: "vertical" });
  assert.equal(lane.look, "lane");
  assert.equal(lane.axis, "vertical");
  assert.deepEqual(serializeItemLayout(lane), { type: "section", look: "lane", axis: "vertical" });
  assert.equal(normalizeItemLayout({ type: "section", look: "lane" }).axis, "horizontal");
  assert.equal(normalizeItemLayout({ type: "section", look: "lane", axis: "sideways" }).axis, "horizontal");
  assert.equal(normalizeItemLayout({ type: "card", look: "lane", axis: "vertical" }).look, undefined);
  assert.equal(normalizeItemLayout({ type: "card", look: "lane", axis: "vertical" }).axis, undefined);
  assert.equal(serializeItemLayout({ type: "card", x: 1, look: "lane", axis: "vertical" }).look, undefined);
  assert.equal(serializeItemLayout({ type: "section", x: 1, axis: "vertical" }).axis, undefined);
});

test("normalizeEdge / serializeEdge", () => {
  const e = normalizeEdge({ type: "edge", from: "a", to: "b", dir: "bad", route: "elbow", weight: 5, fromSide: "left", color: "pink" });
  assert.deepEqual(e, { from: "a", to: "b", fromSide: "left", toSide: "auto", dir: "one", route: "elbow", dash: "solid", weight: 1, color: "pink" });
  assert.deepEqual(serializeEdge(e), { type: "edge", from: "a", to: "b", fromSide: "left", route: "elbow", color: "pink" });
  assert.deepEqual(serializeEdge(normalizeEdge({ from: "a", to: "b" })), { type: "edge", from: "a", to: "b" });
  assert.equal(normalizeEdge({ from: "a", to: "b", weight: 4 }).weight, 4);
  assert.equal(serializeEdge(normalizeEdge({ from: "a", to: "b", weight: 4 })).weight, 4);
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

test("boardString sanitizes braces and newlines and falls back to Untitled board", () => {
  assert.equal(boardString("Plan"), "{{[[diagram]]:Plan}}");
  assert.equal(boardString("a}}b\nc"), "{{[[diagram]]:ab c}}");
  assert.equal(boardString("   "), `{{[[diagram]]:${UNTITLED_BOARD}}}`);
  assert.equal(boardString(), `{{[[diagram]]:${UNTITLED_BOARD}}}`);
  assert.deepEqual(DEFAULT_BOARD_CARD, { w: 320, h: 220 });
});

test("setBoardTitle rewrites only the leading token and keeps its form and trailing text", () => {
  assert.equal(setBoardTitle("{{[[diagram]]:Old}}", "New"), "{{[[diagram]]:New}}");
  assert.equal(setBoardTitle("{{diagram:Old}}", "New"), "{{diagram:New}}");
  assert.equal(setBoardTitle("{{[[diagram]]:Old}} #tag tail", "New"), "{{[[diagram]]:New}} #tag tail");
  assert.equal(setBoardTitle("{{[[diagram]]}}", "New"), "{{[[diagram]]:New}}");
  assert.equal(setBoardTitle("{{diagram:Old}}", "  "), `{{diagram:${UNTITLED_BOARD}}}`);
  assert.equal(setBoardTitle("plain text", "New"), "{{[[diagram]]:New}}");
  assert.equal(parseBoardTitle(setBoardTitle("{{[[diagram]]:Old}}", "New")), "New");
});

test("isUntitledBoard is true for empty and the placeholder title only", () => {
  assert.equal(isUntitledBoard(""), true);
  assert.equal(isUntitledBoard(undefined), true);
  assert.equal(isUntitledBoard("Untitled Board"), true);
  assert.equal(isUntitledBoard("Plan"), false);
});

test("serializeItemLayout keeps the board marker v:2 and a valid bg, drops other values", () => {
  assert.deepEqual(serializeItemLayout({ x: 1, y: 2, v: 2 }), { x: 1, y: 2, v: 2 });
  assert.deepEqual(serializeItemLayout({ x: 1, y: 2, v: 3 }), { x: 1, y: 2 });
  assert.deepEqual(serializeItemLayout({ x: 1, bg: "lines" }), { x: 1, bg: "lines" });
  assert.deepEqual(serializeItemLayout({ x: 1, bg: "neon" }), { x: 1 });
  assert.deepEqual(serializeItemLayout({ x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, w: 3, h: 4 });
});

test("withBoardMarker adds v:2 or strips v and bg without touching layout", () => {
  assert.deepEqual(withBoardMarker({ x: 1, y: 2 }, true), { x: 1, y: 2, v: 2 });
  assert.deepEqual(withBoardMarker(null, true), { v: 2 });
  assert.deepEqual(withBoardMarker({ ":x": 1, ":v": 2, ":bg": "dots" }, false), { x: 1 });
  assert.equal(withBoardMarker({ v: 2, bg: "dots" }, false), null);
  assert.equal(withBoardMarker(null, false), null);
});

test("BOARD_PATTERNS, BOARD_TONES and FIT_PAD", () => {
  assert.deepEqual(BOARD_PATTERNS, ["dots", "lines", "cross", "grid", "plain"]);
  assert.deepEqual(BOARD_TONES, ["paper", ...PALETTE]);
  assert.equal(FIT_PAD, 24);
});

test("pinned and fit round trip through normalize and serialize", () => {
  assert.equal(normalizeItemLayout({ pinned: true }).pinned, true);
  assert.equal(normalizeItemLayout({ pinned: "yes" }).pinned, false);
  assert.equal(normalizeItemLayout(null).pinned, false);
  assert.equal(normalizeItemLayout({ fit: false }).fit, false);
  assert.equal(normalizeItemLayout({ fit: true }).fit, undefined);
  assert.equal(normalizeItemLayout({}).fit, undefined);
  assert.deepEqual(serializeItemLayout({ x: 1, pinned: true }), { x: 1, pinned: true });
  assert.deepEqual(serializeItemLayout({ x: 1, pinned: false }), { x: 1 });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 1, fit: false }), { type: "section", x: 1, fit: false });
  assert.deepEqual(serializeItemLayout({ type: "card", x: 1, fit: false }), { x: 1 });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 1, fit: true }), { type: "section", x: 1 });
  const layout = { type: "section", x: 1, y: 2, w: 3, h: 4, pinned: true, fit: false };
  assert.deepEqual(serializeItemLayout(normalizeItemLayout(serializeItemLayout(layout))), serializeItemLayout(layout));
});

test("bg and bgColor are kept only when valid, and grid is a pattern", () => {
  assert.deepEqual(serializeItemLayout({ x: 1, bg: "grid" }), { x: 1, bg: "grid" });
  assert.deepEqual(serializeItemLayout({ x: 1, bg: "dots", bgColor: "paper" }), { x: 1, bg: "dots", bgColor: "paper" });
  assert.deepEqual(serializeItemLayout({ x: 1, bgColor: "indigo" }), { x: 1, bgColor: "indigo" });
  assert.deepEqual(serializeItemLayout({ x: 1, bgColor: "puce", bg: "neon" }), { x: 1 });
});

test("withBoardMarker off also removes bgColor", () => {
  assert.deepEqual(withBoardMarker({ x: 1, v: 2, bg: "grid", bgColor: "teal" }, false), { x: 1 });
  assert.equal(withBoardMarker({ v: 2, bgColor: "teal" }, false), null);
  assert.deepEqual(withBoardMarker({ x: 1, bgColor: "teal" }, true), { x: 1, bgColor: "teal", v: 2 });
});

test("style keys: card font 10-48, section title, hex, animated dash, defaults", () => {
  assert.equal(normalizeItemLayout({ fontSize: 9 }).fontSize, undefined);
  assert.equal(normalizeItemLayout({ fontSize: 48.5 }).fontSize, undefined);
  assert.equal(normalizeItemLayout({ fontSize: 14 }).fontSize, 14);
  assert.equal(normalizeItemLayout({ type: "section", fontSize: 24, titleSize: 18 }).fontSize, undefined);
  assert.equal(normalizeItemLayout({ type: "section", titleSize: 18 }).titleSize, 18);
  assert.equal(normalizeItemLayout({ type: "text", fontSize: 20 }).fontSize, 20);
  assert.equal(normalizeItemLayout({ textColor: "#F55656", align: "center", fill: "red", border: "nope" }).textColor, "#f55656");
  assert.equal(normalizeItemLayout({ align: "center" }).align, "center");
  assert.equal(normalizeItemLayout({ align: "default" }).align, undefined);
  assert.equal(normalizeItemLayout({ fill: "red" }).fill, "red");
  assert.equal(normalizeItemLayout({ border: "#abc" }).border, undefined);
  assert.deepEqual(serializeItemLayout({ type: "card", x: 1, fontSize: 14, textColor: "#F55656", align: "left" }), { x: 1, textColor: "#f55656", align: "left" });
  assert.deepEqual(serializeItemLayout({ type: "card", x: 1, fontSize: 20 }), { x: 1, fontSize: 20 });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 1, titleSize: 18, titleColor: "teal", areaFill: "#112233" }), { type: "section", x: 1, titleColor: "teal", areaFill: "#112233" });
  assert.deepEqual(serializeItemLayout({ type: "section", x: 1, titleSize: 22 }), { type: "section", x: 1, titleSize: 22 });
  assert.deepEqual(serializeItemLayout({ x: 1, bg: "cross", bgColor: "#ABCDEF" }), { x: 1, bg: "cross", bgColor: "#abcdef" });
  assert.deepEqual(serializeItemLayout({ x: 1, bgColor: "puce" }), { x: 1 });
  const animated = normalizeEdge({ from: "a", to: "b", dash: "animated", color: "#F55656" });
  assert.equal(animated.dash, "animated");
  assert.equal(animated.color, "#f55656");
  assert.deepEqual(serializeEdge(animated), { type: "edge", from: "a", to: "b", dash: "animated", color: "#f55656" });
  assert.equal(normalizeEdge({ from: "a", to: "b", dash: "wavy" }).dash, "solid");
  assert.equal(hexColor("#F55656"), "#f55656");
  assert.equal(hexColor("#fff"), undefined);
  assert.equal(hexColor("red"), undefined);
  assert.equal(styleColor("red"), "red");
  assert.deepEqual(normalizeSectionDefaults({ titleSize: 18, titleColor: "#F55656", junk: 1 }), { titleColor: "#f55656" });
  assert.deepEqual(normalizeSectionDefaults({ titleSize: 22, border: "blue" }), { titleSize: 22, border: "blue" });
  assert.equal(NATIVE_SWATCHES.length, 13);
  assert.equal(shadeHex("#f55656", -0.28), "#b03e3e");
  assert.equal(shadeHex("#000000", -0.28), "#000000");
  assert.equal(cssColor("red", "fill"), "var(--pxd-red-fill)");
  assert.equal(cssColor("#f55656", "line"), "#f55656");
});

test("shape is kept on text, and dropped for a card or an unknown name", () => {
  assert.equal(normalizeItemLayout({ type: "text", shape: "diamond" }).shape, "diamond");
  assert.equal(normalizeItemLayout({ type: "text", shape: "hexagon" }).shape, undefined);
  assert.equal(normalizeItemLayout({ type: "card", shape: "diamond" }).shape, undefined);
  assert.equal(normalizeItemLayout({ type: "section", shape: "ellipse" }).shape, undefined);
  assert.equal(serializeItemLayout({ type: "text", x: 1, shape: "diamond" }).shape, "diamond");
  assert.equal(serializeItemLayout({ type: "text", x: 1, shape: "hexagon" }).shape, undefined);
  assert.equal(serializeItemLayout({ type: "card", x: 1, shape: "diamond" }).shape, undefined);
  assert.equal(serializeItemLayout(normalizeItemLayout({ type: "text", shape: "cylinder" })).shape, "cylinder");
});

test("dailyPageTitle uses English month names and ordinal suffixes", () => {
  const t = (y, m, d) => dailyPageTitle(new Date(y, m - 1, d, 23, 59));
  assert.equal(t(2026, 9, 1), "September 1st, 2026");
  assert.equal(t(2026, 9, 2), "September 2nd, 2026");
  assert.equal(t(2026, 9, 3), "September 3rd, 2026");
  assert.equal(t(2026, 9, 4), "September 4th, 2026");
  assert.equal(t(2026, 9, 11), "September 11th, 2026");
  assert.equal(t(2026, 9, 12), "September 12th, 2026");
  assert.equal(t(2026, 9, 13), "September 13th, 2026");
  assert.equal(t(2026, 9, 21), "September 21st, 2026");
  assert.equal(t(2026, 9, 22), "September 22nd, 2026");
  assert.equal(t(2026, 9, 29), "September 29th, 2026");
  assert.equal(t(2026, 1, 31), "January 31st, 2026");
  assert.equal(t(2026, 12, 23), "December 23rd, 2026");
});
