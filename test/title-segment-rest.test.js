import test from "node:test";
import assert from "node:assert/strict";
import { setTitleLexicon } from "../src/model/title-cap.js";
import { pdfTitlePlan } from "../src/model/pdf.js";
import { scheduleTitleLexiconWarm } from "../src/view/title-lexicon-warm.js";
import { createDeviceOcr } from "../src/host/device-ocr.js";

const lex = new Set("summary of reported cases per population".split(" "));

test("pdfTitlePlan splits run-together words with a lexicon and is unchanged without", () => {
  const src = { metadataTitle: "Annual Summaryofreportedcases" };
  setTitleLexicon(null);
  const plain = pdfTitlePlan(src);
  setTitleLexicon(lex);
  try {
    assert.equal(pdfTitlePlan(src), "Annual Summary of reported cases");
  } finally { setTitleLexicon(null); }
  assert.equal(pdfTitlePlan(src), plain);
});

function harness({ pdf = true, ok = true } = {}) {
  const calls = { warm: 0, repaint: 0, timers: [], idle: [] };
  let disposed = false;
  const win = { requestIdleCallback: (fn) => calls.idle.push(fn) };
  const run = (w = win) => scheduleTitleLexiconWarm({
    win: w,
    hasPdf: () => pdf,
    ocr: () => ({ warmTitleLexicon: async () => { calls.warm++; return ok; } }),
    isDisposed: () => disposed,
    onWarm: () => { calls.repaint++; },
    setTimer: (fn, ms) => calls.timers.push({ fn, ms }),
  });
  return { calls, run, win, dispose: () => { disposed = true; } };
}

test("idle warm is scheduled only with PDF cards", () => {
  const h = harness({ pdf: false });
  assert.equal(h.run(), false);
  assert.equal(h.calls.idle.length + h.calls.timers.length, 0);
});

test("idle warm runs once and repaints once", async () => {
  const h = harness();
  assert.equal(h.run(), true);
  assert.equal(h.calls.warm, 0);
  h.calls.idle[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.warm, 1);
  assert.equal(h.calls.repaint, 1);
});

test("fallback timer is 1500 ms; nothing after dispose", async () => {
  const h = harness();
  h.run({});
  assert.equal(h.calls.timers[0].ms, 1500);
  h.dispose();
  h.calls.timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.warm, 0);
  assert.equal(h.calls.repaint, 0);
});

test("no repaint when the lexicon is not cached or dispose lands mid-read", async () => {
  const miss = harness({ ok: false });
  miss.run(); miss.calls.idle[0](); await new Promise((r) => setImmediate(r));
  assert.equal(miss.calls.repaint, 0);
  const mid = harness();
  mid.run(); mid.calls.idle[0](); mid.dispose(); await new Promise((r) => setImmediate(r));
  assert.equal(mid.calls.repaint, 0);
});

test("warmTitleLexicon is memoized, reads the cache only and never fetches", async () => {
  let reads = 0;
  let fetches = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = () => { fetches++; throw new Error("fetch"); };
  try {
    const ocr = createDeviceOcr({ source: { cachedLexicon: async () => { reads++; return lex; } } });
    const a = ocr.warmTitleLexicon();
    const b = ocr.warmTitleLexicon();
    assert.equal(a, b);
    assert.equal(await a, true);
    assert.equal(reads, 1);
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = saved; setTitleLexicon(null); }
});
