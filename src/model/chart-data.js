// Chart -> table. Pure. What a vision model is asked, how its JSON answer is checked, and how the checked chart
// becomes a pxd-parse table block that the ordinary parsed-table path puts on the board.
// Nothing here touches the DOM, the network, or Roam.

export const MAX_SERIES = 12;
export const MAX_POINTS = 40;
export const MAX_ABS = 1e15;

// Vision models in the order to try. Names are compared lowercased with "-", "_" and "." as spaces.
// OpenAI models are never picked: through the user's Live AI they came back with empty text.
export const MODEL_PREFERENCE = Object.freeze([
  /claude sonnet 5 5/,
  /claude opus 5 5/,
  /gemini 3 8 flash/,
  /gemini 3 1 pro/,
]);

const flat = (text) => String(text ?? "").toLowerCase().replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
const isOpenAi = (m) => /openai|\bgpt\b|^o\d\b/.test(`${flat(m?.provider)} ${flat(m?.id)}`) || /^(gpt|o\d)\b/.test(flat(m?.name));

// models: liveai.listModels() rows ({ id, name, provider, imageInput, isDefault }). null when none can see images.
export function pickVisionModel(models) {
  const usable = (Array.isArray(models) ? models : []).filter((m) => m && m.id && m.imageInput === true && !isOpenAi(m));
  for (const re of MODEL_PREFERENCE) {
    const hit = usable.find((m) => re.test(flat(`${m.id} ${m.name}`)));
    if (hit) return hit;
  }
  return usable.find((m) => m.isDefault) || usable[0] || null;
}

export const CHART_SYSTEM_PROMPT = [
  "You turn one chart image into data.",
  "Answer with a single JSON object and nothing else. Shape:",
  '{"title": string, "x": {"label": string, "unit": string}, "y": {"label": string, "unit": string},',
  ' "series": [{"name": string, "points": [{"x": number or string, "y": number, "approx": true or false}]}], "notes": string}',
  "Read each value off the gridlines or axis ticks. Set approx to true for every value you estimated from the scale and false only when the value is printed on the chart.",
  "Use the names in the legend for the series. If there is no legend and one series, use the y axis label. Never invent a series that is not drawn.",
  "Give at most 40 points per series; for a dense line, pick the points where it changes direction plus evenly spaced ones.",
  "Use numbers for x when the axis is numeric or a date year; use the category text for a bar chart. y must be a number without units or thousands separators.",
  "Put units in x.unit and y.unit, not in the numbers. Use an empty string when the chart shows none.",
  "Use notes for anything not legible, a broken axis, or a log scale. If the image is not a chart, return an empty series list and say so in notes.",
].join("\n");

export const CHART_PROMPT = "Read the chart in the image and return the JSON object described in the instructions.";

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const clip = (text, max) => {
  const t = String(text ?? "");
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};
const altOf = (caption) => clip(squash(String(caption ?? "").replace(/[[\]()!]/g, " ")), 120) || "Chart";

// The context a model gets: the picture first (Anthropic models only see an image as a markdown line in the context),
// then the caption and a little nearby text. `nearby` is already trimmed by the caller; it is clipped again here.
export function chartContext({ url = "", caption = "", nearby = "" } = {}) {
  const parts = [];
  if (url) parts.push(`Image of the chart:\n![${altOf(caption)}](${String(url).trim()})`);
  const cap = squash(caption);
  if (cap) parts.push(`Caption: ${clip(cap, 400)}`);
  const near = String(nearby ?? "").trim();
  if (near) parts.push(`Nearby text:\n${clip(near, 1200)}`);
  return parts.join("\n\n");
}

// "Figure 2" from a caption, else "Figure N" by order among the document's figures, else "Figure".
const LABEL_RE = /^((?:figure|fig\.?|chart|graph|plate|exhibit)\s+[A-Za-z]?\d+(?:\.\d+)?[A-Za-z]?)/i;
export function figureLabel(doc, blockId, caption = "") {
  const m = LABEL_RE.exec(squash(caption));
  if (m) {
    const [, word, rest] = /^([A-Za-z]+)\.?\s+(.+)$/.exec(m[1].replace(/\s+/g, " "));
    const name = /^fig/i.test(word) ? "Figure" : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
    return `${name} ${rest}`;
  }
  const blocks = doc?.blocks && typeof doc.blocks === "object" ? doc.blocks : {};
  const order = Array.isArray(doc?.order) ? doc.order : Object.keys(blocks);
  let n = 0;
  for (const id of order) {
    if (blocks[id]?.type !== "figure") continue;
    n += 1;
    if (id === blockId) return `Figure ${n}`;
  }
  return "Figure";
}

// "Chart data · Figure 2 · p. 4 · Annual report"
export function chartTitle({ label = "Figure", page = null, docTitle = "" } = {}) {
  return ["Chart data", squash(label) || "Figure", Number.isInteger(page) && page > 0 ? `p. ${page}` : "", squash(docTitle)].filter(Boolean).join(" · ");
}

export function chartNote(modelName = "", extra = []) {
  const who = squash(modelName);
  const base = who ? `Values read from the chart by ${who}; approximate.` : "Values read from the chart by a model; approximate.";
  const more = (Array.isArray(extra) ? extra : []).map((t) => squash(t)).filter(Boolean);
  return [base, ...more].join(" ");
}

function stripFence(text) {
  const m = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  return m ? m[1] : text;
}

// The first balanced {...} in the text, string-aware. "" when there is none.
function firstObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

const tryParse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

// A model's answer (parsed object, or text with or without a ```json fence, with chatter around it) -> a plain object, or null.
export function parseChartJson(answer) {
  if (answer && typeof answer === "object" && !Array.isArray(answer)) return answer;
  if (typeof answer !== "string") return null;
  const raw = answer.replace(/“|”/g, '"').trim();
  if (!raw) return null;
  const candidates = [raw, stripFence(raw), firstObject(stripFence(raw)), firstObject(raw)].filter(Boolean);
  for (const c of candidates) {
    const text = c.trim();
    const got = tryParse(text) ?? tryParse(text.replace(/,\s*([}\]])/g, "$1"));
    if (got && typeof got === "object" && !Array.isArray(got)) return got;
  }
  return null;
}

// "1,200" "12%" "3.5e2" "-4" 7 -> number; anything else NaN. "1.234,5" (comma decimal) is not guessed.
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  let t = value.trim().replace(/−/g, "-");
  if (!t) return NaN;
  const paren = /^\(([^)]+)\)$/.exec(t);
  if (paren) t = `-${paren[1]}`;
  t = t.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1").replace(/%$/, "").trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const text = (value, max = 120) => (typeof value === "string" || typeof value === "number" ? clip(squash(value), max) : "");

function axisOf(value) {
  if (typeof value === "string") return { label: text(value), unit: "" };
  const a = value && typeof value === "object" ? value : {};
  return { label: text(a.label ?? a.name ?? a.title), unit: text(a.unit ?? a.units, 40) };
}

// x is a number when it reads as one, else its (short) text. null when there is nothing usable.
function xOf(value) {
  const n = toNumber(value);
  if (Number.isFinite(n)) return Math.abs(n) > MAX_ABS ? null : n;
  const t = text(value, 60);
  return t || null;
}

// Checks and cleans a parsed answer.
// -> { ok: true, chart: { title, x, y, series: [{ name, points: [{ x, y, approx }] }], notes }, warnings: [string] }
//  | { ok: false, reason: "not-json" | "no-series" | "no-points", message }
// Points with a non-numeric y, an unusable x or |value| > 1e15 are dropped; the first of a repeated x wins; a series
// keeps at most 40 points and a chart 12 series; approx defaults to true (a value read off a scale is an estimate).
export function normalizeChart(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!obj) return { ok: false, reason: "not-json", message: "The model's answer was not a chart table." };
  const list = Array.isArray(obj.series) ? obj.series : Array.isArray(obj.data) ? obj.data : [];
  if (!list.length) return { ok: false, reason: "no-series", message: text(obj.notes, 200) || "The model found no chart data in the picture." };
  const warnings = [];
  const series = [];
  const used = new Set();
  let dropped = 0;
  let clipped = false;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const pts = Array.isArray(entry.points) ? entry.points : Array.isArray(entry.data) ? entry.data : [];
    const seen = new Set();
    const points = [];
    for (const p of pts) {
      const isPair = Array.isArray(p) && p.length >= 2;
      const rawX = isPair ? p[0] : p?.x;
      const rawY = isPair ? p[1] : p?.y;
      const x = xOf(rawX);
      const y = toNumber(rawY);
      if (x === null || !Number.isFinite(y) || Math.abs(y) > MAX_ABS) { dropped += 1; continue; }
      const key = typeof x === "number" ? `n:${x}` : `s:${x.toLowerCase()}`;
      if (seen.has(key)) { dropped += 1; continue; }
      seen.add(key);
      const approx = isPair ? true : p.approx === false || p.approx === "false" ? false : true;
      points.push({ x, y, approx });
    }
    if (!points.length) continue;
    if (points.length > MAX_POINTS) { clipped = true; points.length = MAX_POINTS; }
    if (points.every((p) => typeof p.x === "number")) points.sort((a, b) => a.x - b.x);
    let name = text(entry.name ?? entry.label ?? entry.series) || `Series ${series.length + 1}`;
    let base = name;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    series.push({ name, points });
    if (series.length >= MAX_SERIES) break;
  }
  if (!series.length) return { ok: false, reason: "no-points", message: "The model returned series without readable values." };
  if (list.length > MAX_SERIES && series.length >= MAX_SERIES) warnings.push(`Kept the first ${MAX_SERIES} series.`);
  if (clipped) warnings.push(`Kept the first ${MAX_POINTS} points of a series.`);
  if (dropped) warnings.push(`Dropped ${dropped} unreadable or repeated ${dropped === 1 ? "point" : "points"}.`);
  return {
    ok: true,
    chart: { title: text(obj.title, 200), x: axisOf(obj.x), y: axisOf(obj.y), series, notes: text(obj.notes, 400) },
    warnings,
  };
}

// 6 significant digits, no trailing noise: 0.1+0.2 -> "0.3", 1200 -> "1200".
export function formatValue(n) {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(6)));
}

const withUnit = (label, unit) => {
  const l = squash(label);
  const u = squash(unit);
  if (!u) return l;
  if (!l) return u;
  return l.toLowerCase().includes(u.toLowerCase()) ? l : `${l} (${u})`;
};

// The checked chart as a table: first column x (union of every series' x, numeric ascending, else in order seen), one
// column per series, empty cell where a series has no point at that x. A "~" marks an estimated value only when
// the table also holds printed ones (otherwise the note under the table already says every value is approximate).
// Layout: title row (merged across), header row, data rows, note row (merged). -> a pxd-parse table block.
export function chartToTable(chart, { title = "", note = "" } = {}) {
  const series = Array.isArray(chart?.series) ? chart.series : [];
  const keyOf = (x) => (typeof x === "number" ? `n:${x}` : `s:${String(x).toLowerCase()}`);
  const xs = [];
  const seen = new Set();
  for (const s of series) {
    for (const p of s.points) {
      const k = keyOf(p.x);
      if (seen.has(k)) continue;
      seen.add(k);
      xs.push(p.x);
    }
  }
  if (xs.every((x) => typeof x === "number")) xs.sort((a, b) => a - b);
  const lookups = series.map((s) => new Map(s.points.map((p) => [keyOf(p.x), p])));
  const anyExact = series.some((s) => s.points.some((p) => p.approx === false));
  const cols = series.length + 1;
  const cells = [];
  let r = 0;
  const headerRows = (title ? 1 : 0) + 1;
  if (title) {
    cells.push({ r, c: 0, text: squash(title), colSpan: cols });
    r += 1;
  }
  cells.push({ r, c: 0, text: withUnit(chart?.x?.label || "x", chart?.x?.unit) });
  series.forEach((s, i) => cells.push({ r, c: i + 1, text: withUnit(s.name, chart?.y?.unit) }));
  r += 1;
  for (const x of xs) {
    cells.push({ r, c: 0, text: typeof x === "number" ? formatValue(x) : String(x) });
    series.forEach((s, i) => {
      const p = lookups[i].get(keyOf(x));
      if (!p) return;
      cells.push({ r, c: i + 1, text: `${anyExact && p.approx ? "~" : ""}${formatValue(p.y)}` });
    });
    r += 1;
  }
  if (note) {
    cells.push({ r, c: 0, text: squash(note), colSpan: cols });
    r += 1;
  }
  const filled = new Set(cells.map((c) => `${c.r}:${c.c}`));
  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const covered = cells.some((c) => c.r === row && c.colSpan > 1 && col > c.c && col < c.c + c.colSpan);
      if (covered || filled.has(`${row}:${col}`)) continue;
      cells.push({ r: row, c: col, text: "" });
    }
  }
  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return { type: "table", rows: r, cols, headerRows, cells };
}
