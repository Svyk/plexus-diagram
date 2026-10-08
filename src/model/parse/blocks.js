// Parse step: lines -> paragraph groups, joined text with hyphenation and footnote marks. Pure.

export const FOOTNOTE_MARK_RE = /^(\d{1,3}|[a-z]|[*†‡§¶])$/;
const SUPERS = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

export function superscriptDigits(text) {
  return text.split("").map((ch) => SUPERS[ch] ?? ch).join("");
}

const COMMA_SUPER = "\u02d2";
const UNIT_BEFORE_RE = /(?:^|[\s(\/])(?:[kcdmnµu]?m|in|ft|yd|mi)$/i;
const EXPONENT_BASE_RE = /(?:^|[\s×x·(])10$/;
const MARK_RUN_RE = /^\d{1,3}(?:[,\u2013-]\d{1,3})+$/;

// "cm²", "m³", "10⁵": a script that belongs to the number or unit before it, not a note mark.
function isUnitScript(text, mark) {
  if (/^[23]$/.test(mark) && UNIT_BEFORE_RE.test(text)) return true;
  return /^\d{1,2}$/.test(mark) && EXPONENT_BASE_RE.test(text);
}

function superscriptRun(text) {
  return superscriptDigits(text).replace(/,/g, COMMA_SUPER);
}

// Join a line's words into text. Footnote-looking superscripts become refs; other
// super/subscripts stay inline (digits as Unicode superscripts, "1,2" as ¹˒²). A mark
// that stands apart from the word before it belongs to the next word ("¹Quality"):
// its ref position is the start of that word.
export function lineTextWithRefs(line, { collectRefs = true } = {}) {
  let text = "";
  const refs = [];
  let lead = [];
  let prev = null;
  const words = line.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.sup && collectRefs && FOOTNOTE_MARK_RE.test(w.text) && text.length && !isUnitScript(text, w.text)) {
      const next = words[i + 1];
      const apart = prev && next && !next.sup && !next.sub && Number.isFinite(w.x0) && Number.isFinite(prev.x1)
        && w.x0 - prev.x1 > 0.3 * Math.min(prev.size || 10, 10) && !/^[,.;:)\]]/.test(next.text);
      if (apart) lead.push(w.text); else refs.push({ mark: w.text, at: text.length });
      prev = w;
      continue;
    }
    const script = w.sup && (/^\d+$/.test(w.text) || MARK_RUN_RE.test(w.text));
    const piece = script ? superscriptRun(w.text) : w.text;
    let glue = "";
    if ((w.sup || w.sub) && text && !text.endsWith(" ")) glue = "";
    else if (text && /^[,.;:)\]]/.test(piece)) glue = "";
    else glue = text ? " " : "";
    text += glue;
    if (lead.length && !w.sup && !w.sub) {
      for (const mark of lead) refs.push({ mark, at: text.length });
      lead = [];
    }
    text += piece;
    prev = w;
  }
  return { text, refs };
}

// Marks with no matching note (affiliations, anything the line pass could not tell from a
// unit) go back into the text as Unicode superscripts; only linked refs stay in footnoteRefs.
export function inlineUnlinkedRefs(block) {
  const refs = block.footnoteRefs;
  if (!refs || !refs.length || typeof block.text !== "string") return;
  const keep = refs.filter((r) => r.to);
  const drop = refs.filter((r) => !r.to);
  if (!drop.length) return;
  let text = block.text;
  const shifts = [];
  for (const r of [...drop].sort((a, b) => b.at - a.at)) {
    const piece = /^\d+$/.test(r.mark) ? superscriptDigits(r.mark) : r.mark;
    const at = Math.min(Math.max(r.at, 0), text.length);
    text = text.slice(0, at) + piece + text.slice(at);
    shifts.push({ at, n: piece.length });
  }
  for (const r of keep) for (const sh of shifts) if (sh.at <= r.at) r.at += sh.n;
  block.text = text;
  if (keep.length) block.footnoteRefs = keep; else delete block.footnoteRefs;
}

export function joinLines(lines, { collectRefs = true, keepHyphenSet = null } = {}) {
  let text = "";
  const footnoteRefs = [];
  for (const line of lines) {
    const { text: t, refs } = lineTextWithRefs(line, { collectRefs });
    if (!t) continue;
    let glue = " ";
    if (text.endsWith("-") && text.length > 1) {
      const left = /(\S+)-$/.exec(text)?.[1] || "";
      const nextStartsLower = /^[a-z]/.test(t);
      const keep = /\d/.test(left) || (left === left.toUpperCase() && /[A-Z]/.test(left)) || (keepHyphenSet && keepHyphenSet.has(`${left}-${t.split(/\s/)[0]}`));
      if (nextStartsLower && !keep) { text = text.slice(0, -1); glue = ""; }
      else if (/^[A-Za-z0-9]/.test(t)) glue = "";
    }
    if (!text) glue = "";
    const base = text.length + glue.length;
    for (const r of refs) footnoteRefs.push({ mark: r.mark, at: base + r.at });
    text += glue + t;
  }
  return { text: text.replace(/\s+/g, " ").trim(), footnoteRefs };
}

export function spansOf(lines) {
  const spans = [];
  for (const line of lines) {
    for (const w of line.words) {
      if (w.sup && FOOTNOTE_MARK_RE.test(w.text)) continue;
      const last = spans[spans.length - 1];
      const size = Math.round(w.size * 10) / 10;
      const font = w.fontName || w.font || null;
      if (last && last.bold === Boolean(w.bold) && last.italic === Boolean(w.italic) && last.size === size && last.font === font) {
        last.text += ` ${w.text}`;
      } else spans.push({ text: w.text, bold: Boolean(w.bold), italic: Boolean(w.italic), size, font: w.fontName || w.font || null });
    }
  }
  return spans;
}

// Paragraph grouping inside one column: consecutive lines that read as one block.
export function groupParagraphs(lines, { bodySize = 10 } = {}) {
  const groups = [];
  let cur = [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].base - lines[i - 1].base);
  const normalGap = median(gaps.filter((g) => g > 0 && g < 3 * bodySize)) || bodySize * 1.3;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = cur[cur.length - 1];
    let join = Boolean(prev);
    if (prev) {
      const gap = line.base - prev.base;
      const size = Math.max(prev.size, line.size);
      if (gap > 1.7 * size) join = false;
      else if (Math.abs(prev.size - line.size) > 0.6) join = false;
      else if (Boolean(prev.bold) !== Boolean(line.bold) && (prev.chars > 20 || line.chars > 20)) join = false;
      else {
        const first = cur[0];
        const flushWithFirst = Math.abs(line.x0 - first.x0) <= 1.5 * size;
        const flushWithPrev = Math.abs(line.x0 - prev.x0) <= 1.5 * size;
        const prevIndented = cur.length === 1 && prev.x0 - line.x0 > 0.8 * size && prev.x0 - line.x0 < 4 * size;
        if (!(flushWithFirst || flushWithPrev || prevIndented)) join = false;
        else if (/[.?!:]$/.test(prev.text) && /^[A-Z("“]/.test(line.text) && gap > 1.25 * normalGap) join = false;
        else if (/[.?!]$/.test(prev.text) && line.x0 - prev.x0 > 0.8 * size && line.x0 - prev.x0 < 4 * size && cur.length >= 1) join = false;
      }
    }
    if (!join && cur.length) { groups.push(cur); cur = []; }
    cur.push(line);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function median(values) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
