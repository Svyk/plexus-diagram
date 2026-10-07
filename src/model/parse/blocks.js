// Parse step: lines -> paragraph groups, joined text with hyphenation and footnote marks. Pure.

export const FOOTNOTE_MARK_RE = /^(\d{1,3}|[a-z]|[*†‡§¶])$/;
const SUPERS = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

export function superscriptDigits(text) {
  return text.split("").map((ch) => SUPERS[ch] ?? ch).join("");
}

// Join a line's words into text. Footnote-looking superscripts become refs; other
// super/subscripts stay inline (digits as Unicode superscripts).
export function lineTextWithRefs(line, { collectRefs = true } = {}) {
  let text = "";
  const refs = [];
  for (const w of line.words) {
    if (w.sup && collectRefs && FOOTNOTE_MARK_RE.test(w.text) && text.length) {
      refs.push({ mark: w.text, at: text.length });
      continue;
    }
    const piece = w.sup && /^\d+$/.test(w.text) ? superscriptDigits(w.text) : w.text;
    if ((w.sup || w.sub) && text && !text.endsWith(" ")) text += piece;
    else if (text && /^[,.;:)\]]/.test(piece)) text += piece;
    else text += (text ? " " : "") + piece;
  }
  return { text, refs };
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
