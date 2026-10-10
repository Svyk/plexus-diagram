// Parse step: body size, heading levels, title. Pure.

export const NUMBERED_RE = /^((\d+)(\.\d+)*)\.?\s+\S/;
// Tab. / Tabelle are tables. Tafel is a plate (the negative lookahead keeps it out of this alternative).
export const CAPTION_RE = /^(?:table|tabelle|tab(?!el)\.?|fig(?:ure)?s?\.?|figure|plates?|abb(?:ildung(?:en)?)?\.?|tafeln?|tafel|taf\.?)\s*\d+[A-Za-z]?[.:]?(\s|$)/i;

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

// Level for a single line, or 0 when it is not a heading. `isolated`: a gap above the line
// wider than the paragraph pitch (the caller knows the neighbours).
export function headingLevel(line, { bodySize, classes, nextIsBody = true, isolated = false }) {
  const k = Math.round(line.size * 2) / 2;
  const text = line.text.trim();
  if (!text || CAPTION_RE.test(text) || !/[\p{L}\p{N}]/u.test(text)) return 0;
  const idx = classes.indexOf(k);
  if (idx >= 0 && wordCount(text) <= 24) return idx + 1;
  if (idx >= 0) return 0;
  const bodySized = k >= bodySize - 0.5 && k < bodySize * 1.15;
  const hasWord = /[A-Za-z]{3}/.test(text) && (line.mathShare || 0) < 0.1;
  if (line.bold && bodySized && hasWord && wordCount(text) <= 14 && !/[.?!,;]$/.test(text) && nextIsBody) {
    return Math.min(4, classes.length + 1);
  }
  // "3.2. The verification of ..." set in bold or italic at body size, or standing alone
  // above its paragraph: a numbered heading; applyNumbering fixes the depth.
  const depth = numberedDepth(text);
  const rest = depth ? text.replace(NUMBERED_RE, (m, num, a, b, ...r) => m.slice(m.length - 1)) : "";
  const wordy = depth && /^[A-Z][A-Za-z]{2,}/.test(rest) && (line.mathShare || 0) < 0.1 && !line.words.some((w) => w.sup || w.sub);
  if (wordy && bodySized && wordCount(text) <= 14 && !/[.?!,;:]$/.test(text) && (line.bold || line.italic || isolated) && nextIsBody) {
    return Math.min(6, classes.length + depth);
  }
  return 0;
}

// Body-size bold headings all land on one level; order them by size, then bold-only above
// bold-italic, so "Methods" (11 pt bold) sits above "Search strategy" (10.5 pt bold italic).
export function refineBodyHeadingLevels(headings, { classes }) {
  const base = classes.length + 1;
  const body = headings.filter((h) => h.level === base && !numberedDepth(h.text) && h.spans && h.spans.length);
  if (body.length < 2) return headings;
  const key = (h) => { const s = h.spans[0]; return `${Math.round(s.size * 2) / 2}|${s.italic ? 1 : 0}`; };
  const ranks = [...new Set(body.map(key))].sort((a, b) => {
    const [sa, ia] = a.split("|").map(Number); const [sb, ib] = b.split("|").map(Number);
    return sb - sa || ia - ib;
  });
  if (ranks.length < 2) return headings;
  for (const h of body) h.level = Math.min(6, base + ranks.indexOf(key(h)));
  return headings;
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
