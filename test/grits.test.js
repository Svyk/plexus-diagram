import test from "node:test";
import assert from "node:assert/strict";
import { gritsCon, gritsTop, gritsPage, matchTable, toGrid } from "../tools/parse-bench/grits.mjs";
import { tableCounts } from "../tools/parse-bench/scan-score.mjs";

const cell = (r, c, text, extra = {}) => ({ r, c, rowSpan: 1, colSpan: 1, text, header: false, ...extra });
const table = (rows) => rows.flatMap((row, r) => row.map((text, c) => cell(r, c, text)));
const body = [
  ["alpha", "10.5", "gamma one"],
  ["beta", "20.25", "delta two"],
  ["omega", "30.75", "sigma three"],
  ["kappa", "40.125", "theta four"],
];
const f1 = (c) => { const p = c.predN ? c.cellTp / c.predN : 0; const r = c.truthN ? c.cellTp / c.truthN : 0; return p + r ? (2 * p * r) / (p + r) : 0; };

test("identical tables score 1 and 1", () => {
  assert.equal(gritsCon(table(body), table(body)).score, 1);
  assert.equal(gritsTop(table(body), table(body)).score, 1);
});

test("an extra header row keeps content high while exact-anchor F1 collapses", () => {
  const long = Array.from({ length: 12 }, (_, i) => [`item${i}`, `${i * 3 + 1}.5`, `note number ${i}`]);
  const truth = table(long);
  const pred = table([["Name", "Value", "Note"], ...long]);
  const con = gritsCon(pred, truth);
  assert.ok(con.score > 0.9, `con ${con.score}`);
  const counts = tableCounts({ id: "p", cells: pred, rows: 13, cols: 3 }, { cells: truth, rows: 12, cols: 3 });
  assert.ok(f1(counts) < 0.1, `anchor f1 ${f1(counts)}`);
});

test("two swapped columns lower content but stay above half", () => {
  const swapped = body.map(([a, b, c]) => [b, a, c]);
  const s = gritsCon(table(swapped), table(body)).score;
  assert.ok(s < 1 && s > 0.3, `swapped ${s}`);
});

test("merged header versus split header lowers topology only slightly", () => {
  const split = [cell(0, 0, "Group"), cell(0, 1, "Group"), cell(1, 0, "a"), cell(1, 1, "b")];
  const merged = [{ r: 0, c: 0, rowSpan: 1, colSpan: 2, text: "Group" }, cell(1, 0, "a"), cell(1, 1, "b")];
  assert.ok(gritsTop(split, merged).score < 1);
  assert.ok(gritsCon(split, merged).score > 0.95);
  assert.equal(toGrid(merged).grid[0][1].text, "group");
});

test("empty prediction scores 0", () => {
  assert.equal(gritsCon([], table(body)).score, 0);
  assert.equal(gritsTop([], table(body)).score, 0);
  assert.deepEqual(gritsPage([], [{ cells: table(body) }]), { con: 0, top: 0 });
});

test("an unsure truth cell matches anything", () => {
  const truth = table(body).map((c) => (c.r === 1 && c.c === 1 ? { ...c, unsure: true } : c));
  const pred = table(body).map((c) => (c.r === 1 && c.c === 1 ? { ...c, text: "garbage" } : c));
  assert.equal(gritsCon(pred, truth).score, 1);
});

test("an extra predicted table lowers the page score", () => {
  const truth = [{ cells: table(body) }];
  const p1 = { id: "a", cells: table(body) };
  const p2 = { id: "b", cells: table([["zzz", "yyy"], ["xxx", "www"]]) };
  assert.deepEqual(gritsPage([p1], truth), { con: 1, top: 1 });
  const s = gritsPage([p1, p2], truth);
  assert.ok(s.con < 1 && s.top < 1);
  assert.deepEqual(gritsPage([], []), { con: 1, top: 1 });
});

test("an unmatched truth table lowers the page score", () => {
  const truth = [{ cells: table(body) }, { cells: table([["one", "two"], ["three", "four"]]) }];
  const s = gritsPage([{ id: "a", cells: table(body) }], truth);
  assert.ok(s.con < 1 && s.con > 0.5);
});

test("60x15 against 60x15 runs under 200 ms", () => {
  const txt = (r, c) => (c === 0 ? `Item ${r}` : String((((r * 15 + c) * 7919) % 100000) / 10));
  const big = Array.from({ length: 60 }, (_, r) => Array.from({ length: 15 }, (_, c) => txt(r, c)));
  const noisy = big.map((row, r) => row.map((t, c) => (r % 7 === 0 && c % 3 === 0 ? t + "x" : t)));
  let t0 = performance.now();
  const s = gritsCon(table(noisy), table(big));
  assert.ok(performance.now() - t0 < 200, `con ${performance.now() - t0} ms`);
  t0 = performance.now();
  gritsTop(table(noisy), table(big));
  assert.ok(performance.now() - t0 < 200, `top ${performance.now() - t0} ms`);
  assert.ok(s.score > 0.95);
});

test("a heavily misread but correctly placed table gets partial credit", () => {
  const truth = table([
    ["alpha beta", "gamma delta", "epsilon zeta"],
    ["eta theta", "iota kappa", "lambda mu"],
    ["nu xi", "omicron pi", "rho sigma"],
  ]);
  const pred = table([
    ["alpha bota", "gamma dalta", "epsilon zita"],
    ["eta thota", "iota kappe", "lambda mo"],
    ["nu xo", "omicron po", "rho sigme"],
  ]);
  const t = { cells: truth };
  const p = { id: "p1", cells: pred };
  assert.equal(matchTable(t, [p], new Set()), null);
  const s = gritsPage([p], [t]);
  assert.ok(s.con > 0.5 && s.con < 1, `con ${s.con}`);
  assert.equal(s.top, 1);
});

test("a prediction sharing nothing with the truth stays unmatched", () => {
  const s = gritsPage([{ id: "p", cells: table([["qqq"]]) }], [{ cells: table([["zzz"]]) }]);
  assert.equal(s.con, 0);
});
