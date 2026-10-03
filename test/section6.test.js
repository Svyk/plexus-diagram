import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTRIBUTE_TEMPLATE,
  backgroundImage,
  calendarLayout,
  cardTemplatePlan,
  commentCount,
  derivedGraph,
  galleryGrid,
  cardLabel,
  galleryItems,
  graphLayout,
  highlightHits,
  parseCardDate,
  presenterNote,
  printPages,
  routeAround,
  sectionPair,
  thumbnailBudget,
  timelineAxis,
  timerStep,
  versionPeekRequest,
  waypointPath,
  zoomThreshold,
} from "../src/model/section6.js";
import { normalizeEdge, serializeEdge, serializeItemLayout } from "../src/model/schema.js";

const boardOf = (items, extra = {}) => ({
  uid: "board",
  roots: extra.roots || items.map((item) => item.uid),
  items: new Map(items.map((item) => [item.uid, item])),
  edges: new Map((extra.edges || []).map((edge) => [edge.uid, edge])),
});

test("highlight marks and gallery grid", () => {
  assert.deepEqual(highlightHits("keep ^^this phrase^^ and ^^second^^"), ["this phrase", "second"]);
  assert.deepEqual(highlightHits("no marks"), []);
  const board = boardOf([
    { uid: "a", type: "card", kind: "image", title: "Shot", string: "![](https://example.com/a.png)" },
    { uid: "b", type: "card", kind: "note", title: "Words", string: "plain" },
    { uid: "c", type: "section", title: "Lane", string: "" },
  ]);
  const tiles = galleryGrid(galleryItems(board), { cols: 2, cell: 100, gap: 10 });
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].uid, "a");
  assert.equal(tiles[0].x, 0);
  assert.equal(tiles[0].src, "https://example.com/a.png");
});

test("calendar, timeline, and read-only graph", () => {
  const cards = [
    { uid: "d2", type: "card", title: "October 3rd, 2026", string: "" },
    { uid: "d1", type: "card", title: "Note", string: "Date:: 2026-10-01" },
    { uid: "x", type: "card", title: "No date", string: "hello" },
  ];
  assert.equal(parseCardDate(cards[0]), Date.UTC(2026, 9, 3));
  const slots = calendarLayout(cards, { year: 2026, month: 9 });
  assert.deepEqual(slots.map((s) => s.uid), ["d1", "d2"]);
  assert.ok(slots[1].x > slots[0].x);
  const axis = timelineAxis(cards, { width: 100 });
  assert.equal(cardLabel({ title: "", string: "Fixture source\nmore" }), "Fixture source");
  assert.equal(axis[0].uid, "d1");
  assert.equal(axis[0].x, 0);
  assert.equal(axis[1].x, 100);
  const pos = graphLayout(["a", "b", "c"], [["a", "b"]]);
  assert.equal(pos.size, 3);
  assert.ok(Number.isFinite(pos.get("b").x));
  const again = graphLayout(["a", "b", "c"], [["a", "b"]]);
  assert.equal(again.get("a").x, pos.get("a").x);
  const graph = derivedGraph(boardOf(
    [{ uid: "a", type: "card" }, { uid: "s", type: "section" }],
    { edges: [{ uid: "e", from: "a", to: "s", valid: true }] },
  ));
  assert.deepEqual(graph.nodes, ["a"]);
  assert.deepEqual(graph.links, [["a", "s"]]);
});

test("comments, templates, notes, print, and versions", () => {
  const board = boardOf([
    { uid: "card", type: "card", title: "Card", string: "body", members: ["c1", "note"] },
    { uid: "c1", type: "card", title: "", string: "[[comment]] hi", members: [] },
    { uid: "note", type: "text", title: "", string: "Say this first", members: [] },
    { uid: "sec", type: "section", title: "Evidence", string: "", members: ["note"] },
  ], { roots: ["sec"] });
  assert.equal(commentCount(board, "card"), 1);
  assert.equal(presenterNote(board, "sec"), "Say this first");
  assert.deepEqual(printPages(board), [{ uid: "sec", title: "Evidence" }]);
  const plan = cardTemplatePlan([
    { string: "{{smartblock}}" },
    { string: "  Owner:: Ada  " },
    ...ATTRIBUTE_TEMPLATE,
  ]);
  assert.equal(plan[0].string, "Owner:: Ada");
  assert.equal(plan.length, 4);
  assert.equal(versionPeekRequest({}), null);
  assert.equal(versionPeekRequest({ block: { history() {} } }), "block.history");
});

test("waypoints, orthogonal bends, group sections, zoom, thumbnails, timer, image", () => {
  const path = waypointPath({ x: 0, y: 0 }, [{ x: 10, y: 40 }, { x: "no" }], { x: 20, y: 0 });
  assert.match(path.d, /^M0 0L10 40L20 0$/);
  const around = routeAround({ x: 0, y: 50 }, { x: 200, y: 50 }, [{ x: 80, y: 40, w: 40, h: 40 }]);
  assert.equal(around.length, 2);
  assert.ok(around[0].y < 40);
  assert.deepEqual(routeAround({ x: 0, y: 0 }, { x: 10, y: 0 }, [{ x: 100, y: 100, w: 10, h: 10 }]), []);
  assert.deepEqual(sectionPair(["a", "b", "c"], (uid) => ({ type: uid === "a" || uid === "c" ? "section" : "card" })), ["a", "c"]);
  assert.equal(sectionPair(["a"], () => ({ type: "section" })), null);
  assert.equal(zoomThreshold(0.2, 0.6), 0.2);
  assert.equal(zoomThreshold("nope", 0.6), 0.6);
  assert.equal(zoomThreshold(9, "nope"), 0.45);
  assert.deepEqual(thumbnailBudget(["a", "a", "b", "c", "d", "e"], { cap: 4 }), ["a", "b", "c", "d"]);
  const running = timerStep({ remainingMs: 1000, running: true, endsAt: 5_000 }, 4_200);
  assert.equal(running.remainingMs, 800);
  assert.equal(running.running, true);
  const done = timerStep(running, 5_000);
  assert.equal(done.running, false);
  assert.equal(done.endsAt, null);
  assert.equal(backgroundImage("https://cdn.example/bg.png"), "https://cdn.example/bg.png");
  assert.equal(backgroundImage("http://cdn.example/bg.png"), null);
  assert.equal(backgroundImage("javascript:alert(1)"), null);
});

test("edge via and section looks persist", () => {
  const edge = normalizeEdge({ from: "a", to: "b", via: [{ x: 1.26, y: 2 }, { x: NaN, y: 1 }] });
  assert.deepEqual(edge.via, [{ x: 1.3, y: 2 }]);
  assert.deepEqual(serializeEdge(edge).via, [{ x: 1.3, y: 2 }]);
  assert.equal(normalizeEdge({ from: "a", to: "b" }).via, undefined);
  const timer = serializeItemLayout({ type: "section", look: "timer", x: 1, y: 2, w: 200, h: 120 });
  assert.equal(timer.look, "timer");
  assert.equal(timer.axis, undefined);
  const calendar = serializeItemLayout({ type: "section", look: "calendar", axis: "vertical" });
  assert.equal(calendar.look, "calendar");
  assert.equal(calendar.axis, undefined);
});

test("the later-views panel stays hidden until a view opens", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/css/overlays.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-later\[hidden\]\s*\{\s*display:\s*none;/);
});
