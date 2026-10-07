// Parse step: body size, heading levels, title. Pure.

export const NUMBERED_RE = /^((\d+)(\.\d+)*)\.?\s+\S/;
export const CAPTION_RE = /^(table|fig(ure)?\.?|figure)\s*\d+[A-Za-z]?[.:]?(\s|$)/i;

export function bodySizeOf(lines) {
  const counts = new Map();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    counts.set(k, (counts.get(k) || 0) + l.chars);
  }
  let best = 0;
  let size = 10;
  for (const [k, n] of counts) if (n > best) { best = n; size = k; }
  return size;
}

// Size classes above the body, largest first, at most three.
export function headingClasses(lines, bodySize) {
  const counts = new Map();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    if (k >= bodySize * 1.15) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => b - a).slice(0, 3);
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Level for a single line, or 0 when it is not a heading.
export function headingLevel(line, { bodySize, classes, nextIsBody = true }) {
  const k = Math.round(line.size * 2) / 2;
  const text = line.text.trim();
  if (!text || CAPTION_RE.test(text)) return 0;
  const idx = classes.indexOf(k);
  if (idx >= 0 && wordCount(text) <= 24) return idx + 1;
  if (idx >= 0) return 0;
  if (line.bold && k >= bodySize - 0.5 && k < bodySize * 1.15 && wordCount(text) <= 14 && !/[.?!,;]$/.test(text) && nextIsBody) {
    return Math.min(4, classes.length + 1);
  }
  return 0;
}

export function numberedDepth(text) {
  const m = NUMBERED_RE.exec(text.trim());
  if (!m) return 0;
  return m[1].split(".").length;
}

// Reconcile size-derived levels with numbering depth when the document numbers its headings.
export function applyNumbering(headings) {
  const numbered = headings.filter((h) => numberedDepth(h.text) > 0);
  if (numbered.length < 3) return headings;
  const hasTitle = headings.some((h) => h.level === 1 && numberedDepth(h.text) === 0);
  const offset = hasTitle ? 1 : 0;
  let agree = 0;
  for (const h of numbered) if (numberedDepth(h.text) + offset === h.level) agree++;
  if (agree >= Math.ceil(numbered.length * 0.5)) {
    for (const h of numbered) h.level = Math.min(6, numberedDepth(h.text) + offset);
  }
  return headings;
}
