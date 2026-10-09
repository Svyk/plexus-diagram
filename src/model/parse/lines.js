// Parse step 1: pdf.js text items -> words -> lines, in top-left page points.
// Pure. Items come straight from getTextContent(); `transform` is the viewport
// transform at scale 1 (pdf.js convention), so y grows downward after mapping.

const LIGATURES = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
const SUP_MAX_RATIO = 0.85;
const SUP_MIN_SHIFT = 0.1;

// Adobe "AdvOT…" fonts mark weight and slant with a ".B", ".I" or ".BI" suffix.
export const BOLD_RE = /bold|black|heavy|semibold|demibold|extrab|ultrab|-medi\b|cmbx|cmb\d|,bold|-b$|\bbd\b|\.BI?(\+|$)|\.B\b/i;
export const ITALIC_RE = /italic|oblique|-it\b|cmti|cmmi|slanted|-i$|\.B?I(\+|$)/i;
export const MATH_FONT_RE = /math|symbol|cmsy|cmmi|cmex|cmr\d|cmbx\d|msbm|msam|stix|txsy|txmi|pxsy|rsfs|wasy|eufm|euex/i;

export function mul(a, b) {
  // 2x3 affine: a × b (apply b first, then a), pdf.js Util.transform order.
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function normalizeText(str) {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (ch === "­") continue;
    if (LIGATURES[ch]) { out += LIGATURES[ch]; continue; }
    if (ch === " ") { out += " "; continue; }
    if (code >= 0xe000 && code <= 0xf8ff) { out += "•"; continue; }
    out += ch;
  }
  return out;
}

export const MONO_FONT_RE = /mono|courier|cmtt|sftt|lmtt|typewriter|consol|menlo|inconsolata|firacode|sourcecodepro|txtt|beramono|luximono|t1xtt/i;

export function fontFlags(fontName, fonts) {
  const info = fonts && fonts[fontName];
  const name = (info && (info.name || info.fontFamily)) || "";
  const bold = Boolean(info && info.bold) || BOLD_RE.test(name) || (info && info.weight >= 600) || false;
  const italic = Boolean(info && info.italic) || ITALIC_RE.test(name);
  const math = MATH_FONT_RE.test(name);
  // pdf.js reports the generic family it mapped the font to; "monospace" marks code fonts.
  const mono = Boolean(info && info.fontFamily === "monospace") || MONO_FONT_RE.test(name);
  return { bold, italic, math, mono, name };
}

const MATH_CHAR_RE = /[∀-⋿Α-ω←-⇿\u{1D400}-\u{1D7FF}±×÷√∫∑∏≤≥≠∞]/u;

export function isMathChar(ch) {
  return MATH_CHAR_RE.test(ch);
}

// One text item -> glyph pieces split at spaces, each with an estimated x-range.
function piecesOf(item, transform, fonts) {
  const str = normalizeText(item.str || "");
  if (!str) return [];
  const m = mul(transform, item.transform);
  const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]);
  const angle = Math.atan2(m[1], m[0]);
  const rotated = Math.abs(angle) > 0.01;
  const x = m[4];
  const base = m[5];
  const scaleX = Math.hypot(m[0], m[1]) / (Math.hypot(item.transform[0], item.transform[1]) || 1);
  const width = (item.width || 0) * scaleX;
  const flags = fontFlags(item.fontName, fonts);
  // OCR word items (helper /v1/ocr) are whole words: never glue two into one.
  const ocrWord = item.fontName === "ocr";
  if (!str.trim()) return [{ space: true, x0: x, x1: x + width, base, size, rotated, angle }];
  // Letter-spaced OCR text ("N O T I F I A B L E") comes as one-letter pieces: the item is one
  // word with its spaces removed (word breaks inside such an item are not recoverable).
  const spaced = letterSpaced(str) ? str.replace(/\s+/g, "") : null;
  if (spaced) {
    let math = 0;
    for (const ch of spaced) if (isMathChar(ch)) math++;
    return [{ text: spaced, x0: x, x1: x + width, base, size, font: item.fontName, fontName: flags.name, bold: flags.bold, italic: flags.italic, mathFont: flags.math, mono: flags.mono, mathChars: math, rotated, angle, leadingSpace: false, trailingSpace: false, spaced: true }];
  }
  const perChar = width / Math.max(1, str.length);
  const out = [];
  let i = 0;
  const re = /(\s+)|(\S+)/g;
  let match;
  while ((match = re.exec(str))) {
    const start = match.index;
    const end = start + match[0].length;
    if (match[1]) {
      out.push({ space: true, x0: x + start * perChar, x1: x + end * perChar, base, size, rotated });
    } else {
      let math = 0;
      for (const ch of match[2]) if (isMathChar(ch)) math++;
      out.push({
        text: match[2],
        x0: x + start * perChar,
        x1: x + end * perChar,
        base,
        size,
        font: item.fontName,
        fontName: flags.name,
        bold: flags.bold,
        italic: flags.italic,
        mathFont: flags.math,
        mono: flags.mono,
        mathChars: math,
        rotated,
        angle,
        leadingSpace: ocrWord || (start > 0 && str[start - 1] === " "),
        trailingSpace: ocrWord || (end < str.length && str[end] === " "),
        conf: item.conf,
        boxY: ocrWord && item.y0 != null && item.y1 != null ? [item.y0, item.y1] : null,
      });
    }
    i = end;
  }
  return out;
}

export function letterSpaced(str) {
  const parts = str.trim().split(/\s+/);
  if (parts.length < 4) return false;
  const single = parts.filter((p) => p.length === 1).length;
  return single >= 0.6 * parts.length;
}

function sameBaseline(a, b) {
  return Math.abs(a.base - b.base) <= 0.3 * Math.max(a.size, b.size);
}

// Big initials and the smaller capitals of the same word share a baseline (ratio about 0.8).
// pdf.js emits them as two size classes, so a word like "TRANSFORMERS" or "16X16" is split
// across two rows. They are one line. A second line half a line below is not this case.
function mergeSmallCapRows(rows) {
  const dead = new Set();
  const changes = (a, b) => {
    const mark = [];
    for (const p of a.pieces) if (!p.space) mark.push({ x: p.x0, k: 0 });
    for (const p of b.pieces) if (!p.space) mark.push({ x: p.x0, k: 1 });
    mark.sort((p, q) => p.x - q.x);
    let n = 0;
    for (let i = 1; i < mark.length; i++) if (mark[i].k !== mark[i - 1].k) n++;
    return n;
  };
  const initialTouches = (big, small) => big.pieces.some((p) => !p.space && /^[A-Za-z]{1,3}$/.test(p.text || "")
    && small.pieces.some((q) => !q.space && (Math.abs(q.x0 - p.x1) <= 2.5 || Math.abs(q.x1 - p.x0) <= 2.5)));
  for (const a of rows) {
    if (dead.has(a)) continue;
    for (const b of rows) {
      if (a === b || dead.has(b) || dead.has(a)) continue;
      const big = a.size >= b.size ? a : b;
      const small = big === a ? b : a;
      const ratio = small.size / big.size;
      if (ratio < 0.7 || ratio > 0.86) continue;
      if (Math.abs(small.base - big.base) > 1) continue;
      if (changes(big, small) < 2 && !initialTouches(big, small)) continue;
      big.pieces.push(...small.pieces);
      dead.add(small);
    }
  }
  return rows.filter((r) => !dead.has(r));
}

// Group pieces into baseline rows, split rows at wide gaps, merge glyph runs into words.
export function buildLines(items, { transform = [1, 0, 0, 1, 0, 0], fonts = {}, splitGap = 2 } = {}) {
  const pieces = [];
  for (const item of items || []) for (const p of piecesOf(item, transform, fonts)) pieces.push(p);
  const normal = pieces.filter((p) => !p.rotated);
  const rotated = pieces.filter((p) => p.rotated && !p.space);
  normal.sort((a, b) => a.base - b.base || a.x0 - b.x0);

  // Pass 1: rows by baseline among pieces that are not superscript-sized relative to a neighbour.
  const rows = [];
  for (const p of normal) {
    let row = null;
    for (let i = rows.length - 1; i >= 0 && rows[i].base >= p.base - 2 * p.size; i--) {
      const r = rows[i];
      if (sameBaseline(r, p) && Math.abs(r.size - p.size) <= 0.15 * Math.max(r.size, p.size)) { row = r; break; }
    }
    if (!row) {
      row = { base: p.base, size: p.size, pieces: [] };
      rows.push(row);
    }
    row.pieces.push(p);
    if (!p.space && p.size > row.size) row.size = p.size;
  }
  const sized = mergeSmallCapRows(rows);
  rows.length = 0;
  rows.push(...sized);
  // Pass 2: small pieces whose baseline is shifted attach to the row they sit beside (super/subscripts).
  const main = [];
  const small = [];
  for (const r of rows) {
    const text = r.pieces.filter((p) => !p.space);
    const chars = text.reduce((n, p) => n + p.text.length, 0);
    r.chars = chars;
    main.push(r);
  }
  for (const r of main) {
    r.x0 = Math.min(...r.pieces.map((p) => p.x0));
    r.x1 = Math.max(...r.pieces.map((p) => p.x1));
  }
  const kept = [];
  for (const r of main) {
    let host = null;
    for (const h of main) {
      if (h === r || h.size * SUP_MAX_RATIO < r.size || r.chars > 24) continue;
      const shift = (h.base - r.base) / h.size;
      if (Math.abs(shift) > 0.7) continue;
      // A slightly smaller line half a line below is the next line, not a subscript.
      if (Math.abs(shift) >= 0.45 && r.size > 0.65 * h.size) continue;
      const near = r.x0 >= h.x0 - h.size && r.x0 <= h.x1 + h.size;
      if (!near) continue;
      if (!host || Math.abs(h.base - r.base) < Math.abs(host.base - r.base)) host = h;
    }
    if (host) {
      // Small text beside a bigger row: a super/subscript when its baseline is shifted, else inline.
      for (const p of r.pieces) {
        if (p.space) { host.pieces.push(p); continue; }
        const shift = (host.base - p.base) / host.size;
        p.sup = shift >= SUP_MIN_SHIFT;
        p.sub = shift <= -SUP_MIN_SHIFT;
        host.pieces.push(p);
      }
    } else kept.push(r);
  }

  const lines = [];
  for (const r of kept) {
    r.pieces.sort((a, b) => a.x0 - b.x0);
    const words = mergeWords(r.pieces, r.size);
    // Split a baseline row into fragments at wide gaps (column gutters, table columns).
    let frag = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (frag.length) {
        const prev = frag[frag.length - 1];
        if (w.x0 - prev.x1 > splitGap * Math.min(prev.size, w.size)) {
          lines.push(makeLine(frag));
          frag = [];
        }
      }
      frag.push(w);
    }
    if (frag.length) lines.push(makeLine(frag));
  }
  lines.sort((a, b) => a.base - b.base || a.x0 - b.x0);
  lines.forEach((l, i) => { l.i = i; });
  return { lines, rotated };
}

function mergeWords(pieces, rowSize) {
  const words = [];
  let cur = null;
  let gapSpace = false;
  for (const p of pieces) {
    if (p.space) { gapSpace = true; continue; }
    const glue = cur && !gapSpace && !cur.trailingSpace && !p.leadingSpace
      && p.x0 - cur.x1 < 0.2 * Math.min(cur.size, p.size) + 0.3
      && Boolean(cur.sup) === Boolean(p.sup) && Boolean(cur.sub) === Boolean(p.sub);
    if (glue) {
      cur.text += p.text;
      cur.x1 = Math.max(cur.x1, p.x1);
      cur.mathChars += p.mathChars;
      cur.trailingSpace = p.trailingSpace;
      if (p.bold) cur.boldChars += p.text.length;
      if (p.italic) cur.italicChars += p.text.length;
      if (p.mathFont) cur.mathFontChars += p.text.length;
      if (p.mono) cur.monoChars += p.text.length;
      if (p.conf != null) cur.conf = cur.conf == null ? p.conf : Math.min(cur.conf, p.conf);
      continue;
    }
    cur = {
      text: p.text,
      x0: p.x0,
      x1: p.x1,
      base: p.base,
      size: p.size,
      font: p.font,
      fontName: p.fontName,
      bold: p.bold,
      italic: p.italic,
      sup: Boolean(p.sup),
      sub: Boolean(p.sub),
      mathChars: p.mathChars,
      boldChars: p.bold ? p.text.length : 0,
      italicChars: p.italic ? p.text.length : 0,
      mathFontChars: p.mathFont ? p.text.length : 0,
      monoChars: p.mono ? p.text.length : 0,
      trailingSpace: p.trailingSpace,
      conf: p.conf,
      boxY: p.boxY,
    };
    words.push(cur);
    gapSpace = false;
  }
  for (const w of words) {
    // OCR words carry their measured box; born-digital words get one from the font size.
    w.y0 = w.boxY ? w.boxY[0] : w.base - w.size * 0.8;
    w.y1 = w.boxY ? w.boxY[1] : w.base + w.size * 0.22;
    delete w.boxY;
    w.bold = w.boldChars >= w.text.length / 2;
    w.italic = w.italicChars >= w.text.length / 2;
    w.mono = w.monoChars >= w.text.length / 2;
    w.rowSize = rowSize;
    delete w.trailingSpace;
  }
  return words;
}

// Angle (degrees, a multiple of 90) of the rotated text that outweighs the upright text on a
// page, else 0. Pieces are the `rotated` output of buildLines.
export function dominantRotation(rotated, lines) {
  const upright = lines.reduce((n, l) => n + l.chars, 0);
  const byAngle = new Map();
  for (const p of rotated) {
    const deg = Math.round((p.angle * 180) / Math.PI / 90) * 90;
    byAngle.set(deg, (byAngle.get(deg) || 0) + (p.text ? p.text.length : 0));
  }
  let best = 0; let chars = 0;
  for (const [deg, n] of byAngle) if (n > chars) { chars = n; best = deg; }
  return chars > 1.5 * upright && chars >= 20 ? best : 0;
}

export function makeLine(words) {
  const sizes = new Map();
  let chars = 0;
  let bold = 0;
  let italic = 0;
  let math = 0;
  let mathFont = 0;
  for (const w of words) {
    if (w.sup || w.sub) continue;
    const key = Math.round(w.size * 2) / 2;
    sizes.set(key, (sizes.get(key) || 0) + w.text.length);
  }
  for (const w of words) {
    chars += w.text.length;
    if (w.bold) bold += w.text.length;
    if (w.italic) italic += w.text.length;
    math += w.mathChars;
    mathFont += w.mathFontChars;
  }
  let size = 0;
  let best = -1;
  for (const [k, n] of sizes) if (n > best) { best = n; size = k; }
  if (!size) size = Math.max(...words.map((w) => w.size));
  const base = median(words.filter((w) => !w.sup && !w.sub).map((w) => w.base)) ?? words[0].base;
  return {
    words,
    text: words.map((w) => w.text).join(" "),
    x0: Math.min(...words.map((w) => w.x0)),
    x1: Math.max(...words.map((w) => w.x1)),
    y0: base - size * 0.8,
    y1: base + size * 0.22,
    base,
    size,
    chars,
    bold: chars > 0 && bold / chars >= 0.6,
    italic: chars > 0 && italic / chars >= 0.6,
    mathShare: chars > 0 ? Math.max(math, mathFont) / chars : 0,
  };
}

export function median(values) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function lineBox(line) {
  return [round(line.x0), round(line.y0), round(line.x1), round(line.y1)];
}

export function round(n) {
  return Math.round(n * 100) / 100;
}

// Re-line an arbitrary set of words (table cells, figure labels): baseline rows, x order.
export function relineWords(words) {
  const sorted = [...words].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows = [];
  for (const w of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.base - w.base) <= 0.5 * Math.max(r.size, w.size)) r.words.push(w);
    else rows.push({ base: w.base, size: w.size, words: [w] });
  }
  return rows.map((r) => makeLine(r.words.sort((a, b) => a.x0 - b.x0)));
}
