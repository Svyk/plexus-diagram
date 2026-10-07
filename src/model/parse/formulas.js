// Parse step: display formulas from isolated, centred or numbered math lines. Pure.

export const EQ_NUMBER_RE = /^\((\d+(\.\d+)?[a-z]?)\)$/;

export function mathShareOf(line, bodyFont = null) {
  let chars = 0;
  let math = 0;
  let mathFont = 0;
  for (const w of line.words) {
    chars += w.text.length;
    math += w.mathChars || 0;
    if (w.mathFontChars && w.fontName !== bodyFont) mathFont += w.mathFontChars;
  }
  return chars ? Math.max(math, mathFont) / chars : 0;
}

export function isMathLine(line, bodyFont = null) {
  return mathShareOf(line, bodyFont) >= 0.25;
}

// lines: ordered lines of one column with { x0, x1 } column box. Returns [{ start, end, number }].
export function detectFormulas(lines, { column, bodySize, bodyFont = null }) {
  const out = [];
  const colCenter = (column.x0 + column.x1) / 2;
  const colWidth = column.x1 - column.x0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isMathLine(line, bodyFont)) continue;
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const gapAbove = prev ? line.y0 - prev.y1 : Infinity;
    const gapBelow = next ? next.y0 - line.y1 : Infinity;
    const isolated = gapAbove >= 0.5 * line.size && gapBelow >= 0.5 * line.size;
    const last = line.words[line.words.length - 1];
    const number = last && EQ_NUMBER_RE.test(last.text) && last.x1 >= column.x1 - 0.1 * colWidth ? last.text : null;
    const bodyCenter = number ? (line.x0 + line.words[line.words.length - 2]?.x1) / 2 : (line.x0 + line.x1) / 2;
    const centred = Math.abs(bodyCenter - colCenter) <= 0.12 * colWidth;
    if (!(isolated || number) || !(centred || number)) continue;
    let end = i + 1;
    while (end < lines.length && isMathLine(lines[end], bodyFont) && lines[end].y0 - lines[end - 1].y1 <= 1.2 * line.size) end++;
    out.push({ start: i, end, number });
    i = end - 1;
  }
  return out;
}
