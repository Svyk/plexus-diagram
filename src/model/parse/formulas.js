// Parse step: display formulas from isolated, centred or numbered math lines. Pure.

// "(14)", "(3a)", "(2.1)"; Elsevier math fonts map the parentheses to ð Þ.
export const EQ_NUMBER_RE = /^[(ð](\d+(\.\d+)?[a-z]?)[)Þ]$/;

// Is this row of tokens the body of a display equation rather than a table row? Signals: an
// equation number at the right edge of the column, a "name =" lead-in on the left (bracketed
// matrices), oversized delimiter glyphs, or a high share of math glyphs.
export function equationRowSignals(words, { column = null } = {}) {
  if (!words.length) return { number: null, lead: false, delimiters: false, math: false };
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const last = sorted[sorted.length - 1];
  const base = sorted.filter((w) => !w.sup && !w.sub); // "X⁰ = …": the script rides with X
  const first = base[0] || sorted[0];
  const second = base[1];
  const colW = column ? column.x1 - column.x0 : Infinity;
  const number = EQ_NUMBER_RE.test(last.text) && (!column || last.x1 >= column.x1 - 0.12 * colW) ? last.text : null;
  const NAME = /^[A-Za-z][⁰-⁹₀-₉0-9′*ʹ]*$/;
  const EQ = /^(=|¼|:=|≡|≈)$/;
  const lead = (NAME.test(first.text) && Boolean(second) && EQ.test(second.text)) || /^[A-Za-z][⁰-⁹₀-₉0-9′*ʹ]*(=|¼)$/.test(first.text);
  const rowSize = median(sorted.map((w) => w.size)) || 10;
  const delimiters = sorted.some((w) => w.size >= 1.6 * rowSize && /^[\[\]()|{}⎡⎤⎣⎦⎢⎥⎛⎞⎝⎠⎜⎟∣]+$/.test(w.text));
  let chars = 0; let math = 0;
  for (const w of sorted) { chars += w.text.length; math += (w.mathChars || 0) + (w.mathFontChars || 0); }
  return { number, lead, delimiters, math: chars > 0 && math / chars >= 0.25 };
}

function median(values) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

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
