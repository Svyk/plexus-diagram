import assert from "node:assert/strict";
import test from "node:test";

import {
  chartContext, chartNote, chartTitle, chartToTable, figureLabel, formatValue, normalizeChart, parseChartJson, pickVisionModel, toNumber,
  MAX_POINTS, MAX_SERIES,
} from "../src/model/chart-data.js";
import { tableGrid } from "../src/model/parse-schema.js";
import { createFigureImages } from "../src/host/figure-image.js";
import * as liveai from "../src/host/liveai.js";
import { runChartToTable } from "../src/view/chart-table.js";
import { createParseActions } from "../src/view/parse-actions.js";

const GOOD = {
  title: "Sodium by week",
  x: { label: "Week", unit: "" },
  y: { label: "Sodium", unit: "mg" },
  series: [
    { name: "Line A", points: [{ x: 1, y: 10, approx: true }, { x: 2, y: 12.5, approx: true }, { x: 3, y: 11, approx: false }] },
    { name: "Line B", points: [{ x: 2, y: 8, approx: true }, { x: 4, y: 9, approx: true }] },
  ],
  notes: "",
};

const model = (id, name, provider, imageInput = true, isDefault = false) => ({ id, name, provider, imageInput, isDefault });

test("model choice: Sonnet 5.5, then Opus 5.5, then Gemini 3.8 Flash, then Gemini 3.1 Pro; never OpenAI; needs image input", () => {
  const all = [
    model("gpt-6", "GPT 6", "OpenAI", true, true),
    model("g31", "Gemini 3.1 Pro", "Google"),
    model("g38", "Gemini 3.8 Flash", "Google"),
    model("op", "Claude Opus 5.5", "Anthropic"),
    model("so", "Claude Sonnet 5.5", "Anthropic"),
    model("blind", "Claude Sonnet 5.5 text", "Anthropic", false),
  ];
  assert.equal(pickVisionModel(all).id, "so");
  assert.equal(pickVisionModel(all.filter((m) => m.id !== "so")).id, "op");
  assert.equal(pickVisionModel(all.filter((m) => !["so", "op"].includes(m.id))).id, "g38");
  assert.equal(pickVisionModel(all.filter((m) => ["g31", "gpt-6"].includes(m.id))).id, "g31");
  assert.equal(pickVisionModel([model("claude-sonnet-5-5", "x", "Anthropic")]).id, "claude-sonnet-5-5");
  assert.equal(pickVisionModel([all[0]]), null);
  assert.equal(pickVisionModel([model("o3", "o3", "")]), null);
  assert.equal(pickVisionModel([all[5]]), null);
  assert.equal(pickVisionModel([]), null);
  assert.equal(pickVisionModel(null), null);
  assert.equal(pickVisionModel([model("m1", "Some Vision", "X"), model("m2", "Other", "X", true, true)]).id, "m2");
});

test("JSON from the model: bare, fenced, with chatter, trailing commas, curly quotes; garbage gives null", () => {
  const json = JSON.stringify(GOOD);
  assert.deepEqual(parseChartJson(json).series.length, 2);
  assert.equal(parseChartJson("```json\n" + json + "\n```").title, "Sodium by week");
  assert.equal(parseChartJson("Here is the data:\n```\n" + json + "\n```\nHope it helps {not json}").title, "Sodium by week");
  assert.equal(parseChartJson("Sure! " + json + " Done.").title, "Sodium by week");
  assert.equal(parseChartJson('{"title": "a", "series": [{"name": "s", "points": [{"x": 1, "y": 2,},],},],}').series[0].points[0].y, 2);
  assert.equal(parseChartJson('{"title": "a } b", "series": []}').title, "a } b");
  assert.deepEqual(parseChartJson(GOOD), GOOD);
  for (const bad of ["", "   ", "I cannot read this chart.", "{broken", "[1,2,3]", null, undefined, 7, "```json\n```"]) assert.equal(parseChartJson(bad), null, String(bad));
});

test("numbers: separators, percent, unicode minus, parentheses; text and huge values are not numbers", () => {
  assert.equal(toNumber("1,200"), 1200);
  assert.equal(toNumber("12%"), 12);
  assert.equal(toNumber("−3.5"), -3.5);
  assert.equal(toNumber("(4)"), -4);
  assert.equal(toNumber(" 7 "), 7);
  assert.equal(toNumber("3.5e2"), 350);
  assert.ok(Number.isNaN(toNumber("n/a")));
  assert.ok(Number.isNaN(toNumber("")));
  assert.ok(Number.isNaN(toNumber(NaN)));
  assert.ok(Number.isNaN(toNumber(Infinity)));
  assert.ok(Number.isNaN(toNumber(null)));
  assert.ok(Number.isNaN(toNumber("12 mg")));
  assert.equal(formatValue(0.1 + 0.2), "0.3");
  assert.equal(formatValue(1200), "1200");
  assert.equal(formatValue(12.3456789), "12.3457");
  assert.equal(formatValue(NaN), "");
});

test("normalize: a good answer keeps names, units, approx flags and sorts numeric x", () => {
  const shuffled = { ...GOOD, series: [{ name: "A", points: [{ x: 3, y: 1 }, { x: 1, y: 2, approx: false }] }] };
  const out = normalizeChart(shuffled);
  assert.equal(out.ok, true);
  assert.deepEqual(out.chart.series[0].points, [{ x: 1, y: 2, approx: false }, { x: 3, y: 1, approx: true }]);
  assert.equal(out.chart.y.unit, "mg");
  assert.equal(out.chart.title, "Sodium by week");
  assert.deepEqual(out.warnings, []);
});

test("normalize: malformed model output is cleaned or refused, never thrown", () => {
  assert.equal(normalizeChart(null).reason, "not-json");
  assert.equal(normalizeChart([]).reason, "not-json");
  assert.equal(normalizeChart("text").reason, "not-json");
  const none = normalizeChart({ series: [], notes: "This is a photo of a cat." });
  assert.equal(none.reason, "no-series");
  assert.match(none.message, /cat/);
  assert.equal(normalizeChart({}).reason, "no-series");
  assert.equal(normalizeChart({ series: "x" }).reason, "no-series");
  assert.equal(normalizeChart({ series: [{ name: "s", points: [] }] }).reason, "no-points");
  assert.equal(normalizeChart({ series: [{ name: "s", points: [{ x: 1, y: "abc" }, { x: 2 }, null, 5] }] }).reason, "no-points");
  assert.equal(normalizeChart({ series: [null, 3, "x"] }).reason, "no-points");

  const messy = normalizeChart({
    title: 42,
    x: "Year",
    y: { label: ["bad"], unit: 5 },
    series: [
      { points: [{ x: "2020", y: "1,000" }, { x: 2020, y: 5 }, { x: "2021", y: "n/a" }, { x: 2022, y: 1e20 }, { x: "", y: 3 }, [2023, 7], { x: 2024, y: "50%", approx: "false" }] },
      { name: "", points: [{ x: 2020, y: 1 }] },
      { name: "Series 1", points: [{ x: 2020, y: 2 }] },
    ],
  });
  assert.equal(messy.ok, true);
  assert.equal(messy.chart.x.label, "Year");
  assert.equal(messy.chart.title, "42");
  assert.equal(messy.chart.y.label, "");
  assert.equal(messy.chart.y.unit, "5");
  const [a, b, c] = messy.chart.series;
  assert.equal(a.name, "Series 1");
  assert.deepEqual(a.points, [{ x: 2020, y: 1000, approx: true }, { x: 2023, y: 7, approx: true }, { x: 2024, y: 50, approx: false }]);
  assert.equal(b.name, "Series 2");
  assert.equal(c.name, "Series 1 (2)");
  assert.match(messy.warnings.join(" "), /Dropped 4 unreadable or repeated points/);
});

test("normalize: caps at 40 points and 12 series, dedupes x, keeps categories in order, de-duplicates names", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i * 2 }));
  const out = normalizeChart({ series: [{ name: "Dense", points: many }] });
  assert.equal(out.chart.series[0].points.length, MAX_POINTS);
  assert.match(out.warnings.join(" "), /first 40 points/);
  const lots = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, points: [{ x: 1, y: i }] }));
  const capped = normalizeChart({ series: lots });
  assert.equal(capped.chart.series.length, MAX_SERIES);
  assert.match(capped.warnings.join(" "), /first 12 series/);
  const cats = normalizeChart({ series: [{ name: "n", points: [{ x: "Beta", y: 2 }, { x: "alpha", y: 1 }, { x: "BETA", y: 9 }] }] });
  assert.deepEqual(cats.chart.series[0].points.map((p) => p.x), ["Beta", "alpha"]);
  const same = normalizeChart({ series: [{ name: "Same", points: [{ x: 1, y: 1 }] }, { name: "same", points: [{ x: 1, y: 2 }] }] });
  assert.deepEqual(same.chart.series.map((s) => s.name), ["Same", "same (2)"]);
  const alt = normalizeChart({ data: [{ label: "Alt", data: [[1, 2], [2, 3]] }] });
  assert.deepEqual(alt.chart.series[0].points.map((p) => [p.x, p.y]), [[1, 2], [2, 3]]);
});

test("table: first column x, one column per series, union of x sorted, blanks where a series has no point, units in the header", () => {
  const { chart } = normalizeChart(GOOD);
  const table = chartToTable(chart);
  assert.equal(table.type, "table");
  assert.equal(table.cols, 3);
  assert.equal(table.rows, 5);
  assert.equal(table.headerRows, 1);
  const grid = tableGrid(table).map((row) => row.map((slot) => slot.text));
  assert.deepEqual(grid, [
    ["Week", "Line A (mg)", "Line B (mg)"],
    ["1", "~10", ""],
    ["2", "~12.5", "~8"],
    ["3", "11", ""],
    ["4", "", "~9"],
  ]);
});

test("table: title row and note row merge across; all-approximate charts get no tildes; header falls back to x", () => {
  const { chart } = normalizeChart({ series: [{ name: "S", points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }] });
  const table = chartToTable(chart, { title: "Chart data · Figure 2 · p. 4 · Report", note: chartNote("Claude Sonnet 5.5") });
  assert.equal(table.headerRows, 2);
  assert.equal(table.rows, 5);
  const grid = tableGrid(table);
  assert.equal(grid[0][0].text, "Chart data · Figure 2 · p. 4 · Report");
  assert.equal(grid[0][1].covered, true);
  assert.equal(grid[1][0].text, "x");
  assert.equal(grid[2][1].text, "2");
  assert.equal(grid[4][0].text, "Values read from the chart by Claude Sonnet 5.5; approximate.");
  assert.equal(grid[4][1].covered, true);
  assert.equal(table.cells.find((c) => c.r === 0).colSpan, 2);
  assert.equal(table.cells.filter((c) => c.r === 2).length, 2);
});

test("table: categorical x keeps first-seen order across series; unit is not repeated when the label has it", () => {
  const { chart } = normalizeChart({
    x: { label: "Month (mo)", unit: "mo" },
    y: { label: "", unit: "%" },
    series: [{ name: "A", points: [{ x: "Jan", y: 1 }, { x: "Mar", y: 3 }] }, { name: "B", points: [{ x: "Feb", y: 2 }, { x: "Jan", y: 5 }] }],
  });
  const grid = tableGrid(chartToTable(chart)).map((row) => row.map((slot) => slot.text));
  assert.deepEqual(grid[0], ["Month (mo)", "A (%)", "B (%)"]);
  assert.deepEqual(grid.slice(1).map((r) => r[0]), ["Jan", "Mar", "Feb"]);
  assert.deepEqual(grid[1], ["Jan", "1", "5"]);
});

test("titles, labels, notes, context", () => {
  assert.equal(chartTitle({ label: "Figure 2", page: 4, docTitle: "Annual report" }), "Chart data · Figure 2 · p. 4 · Annual report");
  assert.equal(chartTitle({ page: null, docTitle: "" }), "Chart data · Figure");
  const doc = { order: ["a", "f1", "f2"], blocks: { a: { id: "a", type: "para" }, f1: { id: "f1", type: "figure" }, f2: { id: "f2", type: "figure" } } };
  assert.equal(figureLabel(doc, "f2", ""), "Figure 2");
  assert.equal(figureLabel(doc, "f2", "Fig. 7b. Something"), "Figure 7b");
  assert.equal(figureLabel(doc, "zz", ""), "Figure");
  assert.equal(chartNote("M", ["Dropped 1 point."]), "Values read from the chart by M; approximate. Dropped 1 point.");
  const ctx = chartContext({ url: "https://x.test/a.png", caption: "Figure 2. Sodium [n=12]", nearby: "As shown in the text." });
  assert.match(ctx, /^Image of the chart:\n!\[Figure 2\. Sodium n=12\]\(https:\/\/x\.test\/a\.png\)\n\nCaption: Figure 2/);
  assert.match(ctx, /Nearby text:\nAs shown/);
  assert.equal(chartContext({ caption: "c" }), "Caption: c");
  assert.ok(chartContext({ url: "https://x.test/a.png", nearby: "n".repeat(5000) }).length < 1500);
});

// run flow -----------------------------------------------------------------------------------------------------------

const DOC = {
  schema: "pxd-parse/1",
  title: "Sodium report",
  pages: [{ n: 1 }, { n: 4 }],
  order: ["h", "f", "c", "p"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Results" },
    f: { id: "f", type: "figure", page: 4, text: "" },
    c: { id: "c", type: "caption", page: 4, for: "f", text: "Figure 2. Sodium (mg) by week" },
    p: { id: "p", type: "para", page: 4, text: "Sodium rose in week two." },
  },
};
const SONNET = { id: "so", name: "Claude Sonnet 5.5", provider: "Anthropic", capabilities: { imageInput: true } };
const BLIND = { id: "bl", name: "Blind", provider: "X", isDefault: true, capabilities: { imageInput: false } };

function fakeWindow(models, generate) {
  const sent = [];
  return {
    sent,
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => models,
      getDefaultModel: () => models.find((m) => m.isDefault)?.id,
      generate: async (req) => { sent.push(req); return generate(req, sent.length); },
    },
  };
}
const service = (over = {}) => createFigureImages({
  store: { getMeta: async () => null, putMeta: async () => {} },
  upload: async () => "https://f.test/fig.png",
  shrink: async (b) => b,
  ...over,
});
const PNG = () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" });
const image = () => ({ key: "s/f", getBlob: async () => PNG(), name: "figure-p4" });

async function run({ w, svc = service(), insert = async () => ({ ok: true }) }) {
  const toasts = [];
  const added = [];
  const res = await runChartToTable({ doc: DOC, blockId: "f", image: image(), imageService: svc, window: w, toast: (m) => toasts.push(m), addTable: async (p) => { added.push(p); return insert(p); } });
  return { res, toasts, added };
}

test("run: good JSON in json mode gives a titled table with a note, the picture first in the context", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: JSON.stringify(GOOD), json: GOOD, model: "so" }));
  const { res, toasts, added } = await run({ w });
  assert.equal(res.ok, true);
  assert.equal(toasts[0], "Reading chart…");
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].responseFormat, "json_object");
  assert.equal(w.sent[0].model, "so");
  assert.match(w.sent[0].context, /^Image of the chart:\n!\[Figure 2\. Sodium mg by week\]\(https:\/\/f\.test\/fig\.png\)\n/);
  assert.match(w.sent[0].systemPrompt, /JSON/);
  assert.match(w.sent[0].systemPrompt, /never invent a series/i);
  const grid = tableGrid(added[0].table);
  assert.equal(grid[0][0].text, "Chart data · Figure 2 · p. 4 · Sodium report");
  assert.equal(grid.at(-1)[0].text, "Values read from the chart by Claude Sonnet 5.5; approximate.");
  assert.equal(grid[1][0].text, "Week");
});

test("run: text answer in a json fence is parsed when the API returns no json field", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: "Sure.\n```json\n" + JSON.stringify(GOOD) + "\n```", model: "so" }));
  const { res, added } = await run({ w });
  assert.equal(res.ok, true);
  assert.equal(added.length, 1);
});

test("run: a provider that refuses the JSON option gets one plain retry", async () => {
  const w = fakeWindow([SONNET], async (req, n) => {
    if (req.responseFormat) { const e = new Error("no json mode"); e.code = "INVALID_OPTIONS"; throw e; }
    return { text: JSON.stringify(GOOD), model: "so" };
  });
  const { res } = await run({ w });
  assert.equal(res.ok, true);
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1].responseFormat, undefined);
});

test("run: garbled answer says so and suggests another model; nothing is added", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: "The chart shows sodium rising from about ten to twelve.", model: "so" }));
  const { res, toasts, added } = await run({ w });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not-json");
  assert.equal(added.length, 0);
  assert.match(toasts.at(-1), /Could not read a table from Claude Sonnet 5\.5's answer\. Try another model/);
});

test("run: empty answer suggests another model; an empty series list says no chart data", async () => {
  const empty = fakeWindow([SONNET], async () => ({ text: "", model: "so" }));
  const a = await run({ w: empty });
  assert.equal(a.res.reason, "empty");
  assert.match(a.toasts.at(-1), /returned nothing\. Try another model/);
  const none = fakeWindow([SONNET], async () => ({ text: JSON.stringify({ series: [], notes: "A photo." }), model: "so" }));
  const b = await run({ w: none });
  assert.equal(b.res.reason, "no-series");
  assert.match(b.toasts.at(-1), /No chart data found/);
  const rows = fakeWindow([SONNET], async () => ({ text: JSON.stringify({ series: [{ name: "s", points: [{ x: 1, y: "no" }] }] }), model: "so" }));
  assert.equal((await run({ w: rows })).res.reason, "no-points");
});

test("run: Live AI errors are shown as friendly toasts", async () => {
  const w = fakeWindow([SONNET], async () => { const e = new Error("x"); e.code = "RATE_LIMIT"; throw e; });
  const { res, toasts } = await run({ w });
  assert.equal(res.ok, false);
  assert.match(toasts.at(-1), /rate limited/);
});

test("run: images off in settings explains and stops before any model call", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: "{}" }));
  const { res, toasts } = await run({ w, svc: service({ enabled: () => false }) });
  assert.equal(res.reason, "off");
  assert.equal(w.sent.length, 0);
  assert.match(toasts[0], /Send figure images to AI/);
});

test("run: no vision model, no Live AI, upload failure, encrypted graph all stop with a message", async () => {
  const blind = fakeWindow([BLIND], async () => ({ text: "{}" }));
  const a = await run({ w: blind });
  assert.equal(a.res.reason, "no-model");
  assert.match(a.toasts[0], /No model with image input/);
  const b = await run({ w: { addEventListener() {}, removeEventListener() {} } });
  assert.equal(b.res.reason, "unavailable");
  assert.equal(b.toasts[0], liveai.SETUP_HINT);
  const w = fakeWindow([SONNET], async () => ({ text: "{}" }));
  const c = await run({ w, svc: service({ upload: async () => { throw new Error("x"); } }) });
  assert.equal(c.res.reason, "upload-failed");
  assert.match(c.toasts.at(-1), /Could not upload the figure/);
  assert.equal(w.sent.length, 0);
  const d = await run({ w, svc: service({ encrypted: () => true }) });
  assert.equal(d.res.reason, "encrypted");
  assert.match(d.toasts.at(-1), /encrypted/);
});

test("run: a figure uploaded once is reused from the cache; a failed insert reports it", async () => {
  const meta = new Map();
  let uploads = 0;
  const svc = service({ store: { getMeta: async (k) => meta.get(k) ?? null, putMeta: async (k, v) => meta.set(k, v) }, upload: async () => { uploads += 1; return "https://f.test/fig.png"; }, fetchFn: async () => ({ status: 200 }) });
  const w = fakeWindow([SONNET], async () => ({ text: JSON.stringify(GOOD), json: GOOD, model: "so" }));
  await run({ w, svc });
  await run({ w, svc });
  assert.equal(uploads, 1);
  const failed = await run({ w, svc, insert: async () => ({ ok: false }) });
  assert.equal(failed.res.reason, "insert");
  assert.match(failed.toasts.at(-1), /Could not add the table/);
  const thrown = await run({ w, svc, insert: async () => { throw new Error("boom"); } });
  assert.equal(thrown.res.reason, "insert");
});

test("run: not a figure does nothing", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: "{}" }));
  const res = await runChartToTable({ doc: DOC, blockId: "h", imageService: service(), window: w });
  assert.equal(res.reason, "not-figure");
  assert.equal(w.sent.length, 0);
});

test("adapter: json option sets responseFormat and returns the parsed object", async () => {
  const w = fakeWindow([SONNET], async () => ({ text: '{"a":1}', json: { a: 1 }, model: "so" }));
  const res = await liveai.ask({ prompt: "p", model: "so", json: true, window: w });
  assert.deepEqual(res.json, { a: 1 });
  assert.equal(w.sent[0].responseFormat, "json_object");
  const plain = await liveai.ask({ prompt: "p", model: "so", window: w });
  assert.equal("json" in plain, true);
  const w2 = fakeWindow([SONNET], async () => ({ text: "x" }));
  const r2 = await liveai.ask({ prompt: "p", window: w2 });
  assert.equal("json" in r2, false);
  assert.equal(w2.sent[0].responseFormat, undefined);
});

test("insertChartTable: places a table with the figure pin, refuses an empty table", async () => {
  const calls = [];
  const session = { insertParsedTable: async (p) => { calls.push(p); return { ok: true, uid: "tbl" }; } };
  const toasts = [];
  const actions = createParseActions({ session, toast: (m) => toasts.push(m), placeBeside: () => ({ x: 10, y: 20 }) });
  const { chart } = normalizeChart(GOOD);
  const table = chartToTable(chart, { title: "T", note: "N" });
  const pin = { pdfUid: "pdf123456", page: 4, frac: [0, 0, 1, 1], caption: "Fig" };
  const res = await actions.insertChartTable({ table, pdfUid: "pdf123456", pin });
  assert.equal(res.ok, true);
  assert.equal(calls[0].table, table);
  assert.equal(calls[0].pin, pin);
  assert.equal(calls[0].x, 10);
  assert.deepEqual(calls[0].notes, []);
  assert.deepEqual(toasts, ["Chart data inserted"]);
  assert.equal((await actions.insertChartTable({ table: { type: "table", rows: 0 } })).reason, "empty");
  assert.equal((await actions.insertChartTable({})).reason, "empty");
});
