#!/usr/bin/env node
// Synthetic `pxd-phd/1` blueprints for testing the builder before the real one exists.
//   node tools/live/phd/synth.mjs --out DIR [--name synth] [--boards 40] [--cards 3000] [--edges 5000]
//        [--highlights 1200] [--depth 4] [--pdfs DIR] [--max-pdfs 8] [--main-share 0.35] [--seed 7]
//   --fixture  = the small every-feature fixture (2 boards, 60 cards, 3 PDFs, 40 highlights).
// Highlight text is cut verbatim from the PDFs' own text (pdf.js), so the builder can find it.
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { loadPdfText } from "./lib/pdftext.mjs";
import { CARD_TYPES } from "./lib/blueprint.mjs";
import { tableSize, SIZES } from "./lib/layout.mjs";

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Word windows of 8-24 words from one page's text, non-overlapping, in reading order.
export function phrases(pageText, rand, max) {
  const words = pageText.split(/\s+/).filter(Boolean);
  const out = [];
  let i = Math.floor(rand() * 5);
  while (i < words.length - 8 && out.length < max) {
    const n = 8 + Math.floor(rand() * 16);
    const chunk = words.slice(i, i + n);
    if (chunk.length >= 8 && chunk.join(" ").length >= 40) out.push(chunk.join(" "));
    i += n + 1 + Math.floor(rand() * 6);
  }
  return out;
}

// Page text as a reader sees it: a space between items only at line ends or across a visible gap.
export function joinItems(items) {
  let out = "";
  let prev = null;
  for (const it of items) {
    if (prev) {
      const h = Number(it.height) || 10;
      const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < h * 0.5;
      const gap = it.transform[4] - (prev.transform[4] + (Number(prev.width) || 0));
      if (prev.hasEOL || !sameLine || gap > h * 0.15) out += " ";
    }
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, " ").trim();
}

const COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
const HL = ["yellow", "red", "green", "blue", "purple"];
const LABELS = ["supports", "contradicts", "causes", "leads to", "part of", "measured by", "controls", "", "", ""];
const TOPICS = ["Cronobacter persistence", "spray dryer", "Zone 1 swab", "PAA + ethanol", "B. cereus spores", "water activity", "biofilm on stainless", "EMP trend", "dose-response", "dry cleaning", "HEPA filter", "nitrogen sparging", "can seamer", "ISO 22964", "qPCR screen"];

export async function synth(opts) {
  const o = {
    name: "synth", boards: 40, cards: 3000, edges: 5000, highlights: 1200, depth: 4, pdfs: null, maxPdfs: 8,
    mainShare: 0.35, seed: 7, fixture: false, ...opts,
  };
  if (o.fixture) Object.assign(o, { name: "fixture", boards: 2, cards: 60, edges: 70, highlights: 42, depth: 2, maxPdfs: 3, mainShare: 0.6 });
  const rand = rng(o.seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const out = resolve(o.out);
  await mkdir(join(out, "cards"), { recursive: true });
  await mkdir(join(out, "pdfs"), { recursive: true });

  // ---- library from real PDFs ----
  const pdfDir = o.pdfs || resolve(new URL("../../../test/fixtures/pdf", import.meta.url).pathname);
  const names = (await readdir(pdfDir)).filter((n) => n.endsWith(".pdf") && !/imageonly|scan/.test(n)).sort().slice(0, o.maxPdfs);
  const texts = [];
  for (const n of names) {
    const t = await loadPdfText(await readFile(join(pdfDir, n)));
    const pages = t.pages.map((p) => joinItems(p.items));
    if (pages.join(" ").split(" ").length > 40) texts.push({ file: n, pages, numPages: t.numPages });
  }
  if (!texts.length) throw new Error(`no text PDFs in ${pdfDir}`);
  const library = texts.map((t, i) => ({
    id: `S${String(i + 1).padStart(3, "0")}`, kind: "pdf", title: `${basename(t.file, ".pdf")} (synthetic source ${i + 1})`,
    authors: [`Author${i + 1} A`], year: 2010 + (i % 15), venue: "Synthetic Journal", url: "", pages: t.numPages, license: "OA",
    why: "synthetic stress source", chapter: ["C1"], file: `S${String(i + 1).padStart(3, "0")}.pdf`, highlights: [],
  }));
  for (const [i, t] of texts.entries()) await copyFile(join(pdfDir, t.file), join(out, "pdfs", library[i].file));
  // Spread highlights: the first three sources take the most (>=150 each when the total allows).
  const weights = library.map((_, i) => (i < 3 ? 4 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  library.forEach((s, i) => {
    const want = Math.round((o.highlights * weights[i]) / wsum);
    const t = texts[i];
    const pool = [];
    for (let pg = 0; pg < t.pages.length; pg += 1) for (const ph of phrases(t.pages[pg], rand, 400)) pool.push({ page: pg + 1, text: ph });
    // Reuse the pool when the PDF is short: a highlight may repeat a passage (Roam allows overlapping highlights).
    for (let k = 0; k < want && pool.length; k += 1) {
      const src = pool[k % pool.length];
      s.highlights.push({ page: src.page, text: src.text, color: pick(HL), tag: pick(["method", "result", "limitation", "definition"]), ...(rand() < 0.4 ? { note: `My note ${k}: why this matters for ${pick(TOPICS)}.` } : {}) });
    }
  });

  // ---- board tree ----
  const boards = [{ id: "B0", title: o.fixture ? "Fixture map" : "Synthetic dissertation map", parent: null, view: "board", sections: [] }];
  for (let i = 1; i < o.boards; i += 1) {
    const depthOf = (b) => (b.parent ? depthOf(boards.find((x) => x.id === b.parent)) + 1 : 1);
    let parent = i < o.depth ? `B${i - 1}` : pick(boards.filter((b) => depthOf(b) < o.depth)).id;
    boards.push({ id: `B${i}`, title: `${pick(TOPICS)} board ${i}`, parent, view: pick(["board", "kanban", "timeline", "gallery", "graph"]), sections: [] });
  }
  const perBoard = new Map();
  const mainCards = o.boards === 1 ? o.cards : Math.round(o.cards * o.mainShare);
  const rest = o.cards - mainCards;
  boards.forEach((b, i) => perBoard.set(b.id, i === 0 ? mainCards : Math.floor(rest / (o.boards - 1)) + (i <= rest % (o.boards - 1) ? 1 : 0)));

  const typeCycle = o.fixture ? [...CARD_TYPES.filter((t) => t !== "board"), "highlight", "highlight", "pin", "highlight", "image", "table"] : ["note", "note", "note", "quote", "claim", "question", "pageref", "pdf", "image", "table", "highlight", "highlight", "highlight", "todo", "code", "formula", "web", "query", "ai-answer", "blockref", "embed", "chart", "pin"];
  const cards = [];
  let hlCursor = 0;
  const allHl = library.flatMap((s) => s.highlights.map((h, i) => ({ s: s.id, i })));
  let kn = 0;
  const nextId = () => `K${++kn}`;
  for (const b of boards) {
    const n = perBoard.get(b.id);
    const nSec = Math.max(2, Math.round(n / 45));
    const perSec = Math.ceil(n / nSec);
    const cols = Math.max(1, Math.ceil(Math.sqrt(perSec)));
    const secW = 40 + cols * 450;
    const secH = 80 + Math.ceil(perSec / cols) * 360;
    const secCols = Math.ceil(Math.sqrt(nSec));
    for (let s = 0; s < nSec; s += 1) {
      const nested = s > 0 && s % 5 === 0;
      if (nested) {
        const host = b.sections[b.sections.length - 1];
        // A small section inside the previous one (bottom-right corner); the host grows to hold it.
        host.h += 420;
        b.sections.push({ id: `${b.id}S${s}`, title: `Nested ${pick(TOPICS)}`, color: pick(COLORS), x: host.x + 40, y: host.y + host.h - 400, w: Math.min(host.w - 80, 960), h: 360, parent: host.id });
      } else {
        const idx = b.sections.filter((x) => !x.parent).length;
        b.sections.push({ id: `${b.id}S${s}`, title: `${pick(TOPICS)} ${s + 1}`, color: pick(COLORS), x: (idx % secCols) * (secW + 200), y: Math.floor(idx / secCols) * (secH + 640), w: secW, h: secH });
      }
    }
    let placed = 0;
    const nested = b.sections.filter((x) => x.parent).length;
    const topQuota = Math.ceil(Math.max(0, n - nested * 2) / Math.max(1, b.sections.length - nested));
    for (const sec of b.sections) {
      const m = sec.parent ? Math.min(2, n - placed) : Math.min(topQuota, n - placed);
      for (let k = 0; k < m; k += 1) {
        const t = typeCycle[(placed + kn) % typeCycle.length];
        const c = { id: nextId(), board: b.id, section: sec.id };
        const col = k % (sec.parent ? 2 : cols);
        const row = Math.floor(k / (sec.parent ? 2 : cols));
        c.x = sec.x + 24 + col * 450;
        c.y = sec.y + (sec.parent ? 48 : 56) + row * 360;
        const src = pick(library);
        if (t === "highlight") {
          const h = allHl[hlCursor++ % allHl.length];
          Object.assign(c, { type: "quote", source: h.s, highlight: h.i, text: "" });
        } else if (t === "pin") {
          Object.assign(c, { type: "quote", source: src.id, page: 1, region: { page: 1, f: [0.1, 0.1 + rand() * 0.5, 0.6, 0.12] }, text: `Pinned figure from ${src.id}` });
        } else {
          c.type = t;
          c.text = `${pick(TOPICS)}: synthetic ${t} card ${c.id}. [[PhD/Concepts/${pick(TOPICS).replace(/[^\w ]/g, "")}]] #phd-synth`;
          if (t === "pageref") c.text = `[[PhD/Concepts/${pick(TOPICS).replace(/[^\w ]/g, "")}]]`;
          if (t === "pdf") c.source = src.id;
          if (t === "image") { c.image = { source: src.id, page: 1, crop: [0.05, 0.05, 0.9, 0.35] }; c.text = `Figure crop ${c.id}`; if (rand() < 0.5) c.region = { f: [0.2, 0.2, 0.3, 0.3], caption: "region of interest" }; }
          if (t === "table") c.table = { caption: `Swab results ${c.id}`, header: true, rows: [["Site", "Zone", "Result", "CFU"], ...Array.from({ length: 4 }, (_, r) => [`S-${r + 1}`, `Z${1 + (r % 3)}`, rand() < 0.2 ? "Positive" : "Negative", String(Math.floor(rand() * 50))])] };
          if (t === "chart") c.chart = { kind: "line", title: `Positives per quarter ${c.id}`, x: { label: "Quarter" }, series: [{ name: "Zone 2", points: [[1, 2], [2, 3], [3, 1], [4, 4]] }, { name: "Zone 3", points: [[1, 5], [2, 6], [3, 4], [4, 7]] }] };
          if (t === "query") c.query = "{{[[query]]: {and: [[PhD/Concepts/EMP trend]] [[TODO]]}}}";
          if (t === "code") c.text = "```r\nlibrary(data.table)\ndt[, .(pos = sum(result == \"Positive\")), by = .(zone, quarter)]\n```";
          if (t === "formula") c.text = "$$P(ill) = 1 - (1 + d/\\beta)^{-\\alpha}$$";
          if (t === "web") { c.url = "https://www.fda.gov/food/infant-formula-guidance-documents-regulatory-information"; c.text = "FDA infant formula guidance"; }
          if (t === "todo") c.text = `Re-run swab campaign ${c.id}`;
          if (t === "ai-answer") { c.text = `AI answer: summary of ${pick(TOPICS)} across sources.`; c.source = src.id; c.children = ["Point one from the sources.", { text: "Point two", children: ["detail"] }]; }
          if (t === "blockref" || t === "embed") c.ref = cards.length ? pick(cards.filter((x) => x.board === b.id) .concat(cards.slice(-1))).id : undefined;
          if ((t === "blockref" || t === "embed") && !c.ref) { c.type = "note"; }
          if (t === "board") { c.type = "note"; }
          if (rand() < 0.3) c.color = pick(COLORS);
          if (rand() < 0.15) c.children = [...(c.children || []), `child of ${c.id}`, { text: "nested", children: ["deeper"] }];
          if (rand() < 0.02) c.text += ` ${"Long card padding sentence about spore inactivation kinetics. ".repeat(60)}`;
        }
        if (rand() < 0.03) c.comment = `Committee comment on ${c.id}`;
        cards.push(c);
        placed += 1;
      }
    }
  }
  // Nested-board cards: one per child board, on its parent, below the sections.
  for (const b of boards.slice(1)) {
    const parent = boards.find((x) => x.id === b.parent);
    const bottom = Math.max(0, ...parent.sections.map((s) => s.y + s.h));
    const k = cards.filter((c) => c.board === parent.id && c.type === "board").length;
    const c = { id: nextId(), board: parent.id, type: "board", text: b.title, x: (k % 8) * 380, y: bottom + 120 + Math.floor(k / 8) * 280 };
    cards.push(c);
    b.card = c.id;
  }

  // ---- edges ----
  const byBoard = new Map();
  for (const c of cards) { if (!byBoard.has(c.board)) byBoard.set(c.board, []); byBoard.get(c.board).push(c); }
  const edges = [];
  const seen = new Set();
  let en = 0;
  const share = (id) => (byBoard.get(id)?.length || 0) / cards.length;
  for (const b of boards) {
    const list = byBoard.get(b.id) || [];
    if (list.length < 2) continue;
    const want = Math.round(o.edges * share(b.id));
    let guard = 0;
    while (edges.filter((e) => e._b === b.id).length < want && guard++ < want * 20) {
      const a = list[Math.floor(rand() * list.length)];
      const near = rand() < 0.8;
      const ia = list.indexOf(a);
      const z = near ? list[Math.min(list.length - 1, Math.max(0, ia + 1 + Math.floor(rand() * 6) - 3))] : pick(list);
      if (!z || z.id === a.id || seen.has(`${a.id}>${z.id}`)) continue;
      seen.add(`${a.id}>${z.id}`);
      const e = { _b: b.id, from: a.id, to: z.id, label: pick(LABELS) };
      if (e.label === "contradicts") e.kind = "contradicts";
      if (e.label === "causes") e.kind = "causes";
      if (rand() < 0.08) e.both = true;
      if (a.type === "table" && rand() < 0.5) e.fromCell = [1, 2];
      if (z.type === "table" && rand() < 0.5) e.toCell = [2, 0];
      if (z.type === "image" && z.region) e.toRegion = true;
      if (rand() < 0.04) e.id = `E${++en}`;
      edges.push(e);
    }
  }
  // Arrows to arrows: a few edges point at an edge that has an id.
  const withId = edges.filter((e) => e.id);
  for (const target of withId.slice(0, Math.max(1, Math.floor(withId.length / 4)))) {
    const list = byBoard.get(target._b);
    const a = pick(list);
    if (a.id !== target.from && a.id !== target.to) edges.push({ _b: target._b, from: a.id, to: target.id, label: "explains" });
  }
  for (const e of edges) delete e._b;

  // ---- extras ----
  const extras = {
    pages: [{ title: `PhD/${o.name} notes`, blocks: ["Synthetic chapter page", { text: "with children", children: ["one", "two"] }] }],
    comments: cards.filter((c) => c.type === "note").slice(0, 5).map((c) => ({ card: c.id, text: `Advisor: tighten ${c.id}` })),
    views: boards.slice(0, Math.min(5, boards.length)).map((b) => ({ board: b.id, caption: `Focus on ${b.title}`, cards: (byBoard.get(b.id) || []).slice(0, 6).map((c) => c.id) })),
    snapshots: boards.slice(0, Math.min(5, boards.length)).map((b, i) => ({ board: b.id, shift: [i * 10, 0] })),
    trails: boards.slice(0, Math.min(5, boards.length)).map((b) => ({ board: b.id, name: `Walk ${b.id}`, stops: (byBoard.get(b.id) || []).slice(0, 5).map((c, j) => (j === 0 ? { card: c.id, note: "start here" } : c.id)) })),
    notebook: [0, 1, 2, 3, 4].map((d) => ({ date: new Date(Date.UTC(2026, 8, 20 + d)).toISOString().slice(0, 10), blocks: [`Lab notebook: worked on [[${o.fixture ? "PhD/Fixture map" : `PhD/${o.name} root`}]] today (${o.name})`] })),
  };
  const root = o.fixture ? "PhD/Fixture map" : `PhD/${o.name} root`;
  const meta = { schema: "pxd-phd/1", title: `${o.name} blueprint`, thesis: "synthetic", years: [2022, 2026], root, stateName: o.name, synthetic: true, counts: { cards: cards.length, edges: edges.length, boards: boards.length, highlights: library.reduce((a, s) => a + s.highlights.length, 0) } };
  await writeFile(join(out, "meta.json"), JSON.stringify(meta, null, 1));
  await writeFile(join(out, "library.json"), JSON.stringify(library, null, 1));
  await writeFile(join(out, "boards.json"), JSON.stringify(boards, null, 1));
  await writeFile(join(out, "edges.jsonl"), edges.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await writeFile(join(out, "extras.json"), JSON.stringify(extras, null, 1));
  for (const b of boards) await writeFile(join(out, "cards", `${b.id}.jsonl`), (byBoard.get(b.id) || []).map((c) => JSON.stringify(c)).join("\n") + "\n");
  return { out, meta };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i].replace(/^--/, "");
    if (k === "fixture") o.fixture = true;
    else { const v = argv[++i]; o[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = /^[\d.]+$/.test(v) ? Number(v) : v; }
  }
  if (!o.out) { console.error("usage: synth.mjs --out DIR [--fixture] [--cards N ...]"); process.exit(1); }
  synth(o).then((r) => console.log("wrote", r.out, JSON.stringify(r.meta.counts))).catch((e) => { console.error(e); process.exit(1); });
}
