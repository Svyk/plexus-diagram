// Word boxes from the image itself. A det line box often spans several table columns, and a
// CTC frame is ~8 px of a 48 px-high crop, so frame-based word edges drift by a glyph. Inside
// each line box: ink mask → vertical projection → runs of empty columns. A gap wider than a
// fraction of the ink height is a word (or column) break; each word is then read on its own.

// mask: Uint8Array page ink (1 = ink), row-major pageW wide. Box in page pixels.
// Rows that are mostly ink across the box are a ruling line, and a column inked over almost
// the whole box height is a vertical rule: both count as empty so they never join two words.
export function inkProjection(mask, pageW, pageH, box) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(pageW, Math.ceil(box.x1));
  const y1 = Math.min(pageH, Math.ceil(box.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const ruleRow = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * pageW + x0;
    let longest = 0;
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) { run++; if (run > longest) longest = run; } else run = 0;
    }
    // A rule under a short box ("1994" over a table rule) is no longer than 3 box heights, but
    // it runs out through both box edges, which a glyph stroke inside the unclip margin does not.
    const through = mask[row] && mask[row + w - 1] && longest >= 0.9 * w;
    if ((longest >= 0.6 * w && longest >= 3 * h) || through) ruleRow[y] = 1;
  }
  const cols = new Uint16Array(w);
  const rowInk = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    if (ruleRow[y]) continue;
    const row = (y0 + y) * pageW + x0;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) { cols[x]++; rowInk[y]++; }
    }
  }
  const live = h - ruleRow.reduce((s, v) => s + v, 0);
  for (let x = 0; x < w; x++) {
    if (cols[x] >= 0.92 * live && live >= 6) {
      const left = x > 0 ? cols[x - 1] : 0;
      const right = x < w - 1 ? cols[x + 1] : 0;
      if (left < 0.6 * live || right < 0.6 * live) cols[x] = 0;
    }
  }
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    if (rowInk[y]) { if (top < 0) top = y; bottom = y; }
  }
  return { x0, y0, w, h, cols, rowInk, ruleRow, top, bottom };
}

// Ink runs separated by at least minGap empty columns. Specks (fewer than minInk pixels) drop.
export function inkRuns(cols, minGap, minInk = 2) {
  const runs = [];
  let start = -1;
  let last = -1;
  let ink = 0;
  for (let x = 0; x < cols.length; x++) {
    if (!cols[x]) continue;
    if (start >= 0 && x - last - 1 >= minGap) {
      if (ink >= minInk) runs.push({ x0: start, x1: last + 1, ink });
      start = -1;
      ink = 0;
    }
    if (start < 0) start = x;
    last = x;
    ink += cols[x];
  }
  if (start >= 0 && ink >= minInk) runs.push({ x0: start, x1: last + 1, ink });
  return runs;
}

// Empty-column gaps inside [from, to), widest first: [{ x0, x1, w }] in projection columns.
export function innerGaps(cols, from, to) {
  const gaps = [];
  let start = -1;
  for (let x = from; x < to; x++) {
    if (!cols[x]) { if (start < 0) start = x; continue; }
    if (start > from) gaps.push({ x0: start, x1: x, w: x - start });
    start = -1;
  }
  return gaps;
}

// Ink rows between proj columns c0..c1, in page pixels. base is the last row that still
// carries a quarter of the busiest row (descenders and specks are thinner; det box heights follow
// the box width through unclip, so the box bottom is no baseline). top..bottom is the block of
// inked rows around the busiest row: ink from the line above or below, cut off by an empty row,
// stays out of the recogniser's crop.
export function inkRows(mask, pageW, proj, c0, c1) {
  const rows = new Uint32Array(proj.h);
  const span = c1 - c0;
  let solid = 0;
  let glyphRows = 0;
  for (let y = 0; y < proj.h; y++) {
    if (proj.ruleRow[y]) continue;
    const row = (proj.y0 + y) * pageW + proj.x0;
    let n = 0;
    for (let x = c0; x < c1; x++) n += mask[row + x];
    rows[y] = n;
    if (span >= 4 && n >= 0.85 * span) solid++;
    else if (n) glyphRows++;
  }
  // An underline is the busiest row of an underlined word ("2009" heading a column). With glyph
  // rows beside it, solid rows count as empty; a bare dash is all solid rows and stays as it is.
  if (solid && glyphRows) {
    for (let y = 0; y < proj.h; y++) if (rows[y] >= 0.85 * span) rows[y] = 0;
  }
  let max = 0;
  let peak = -1;
  for (let y = 0; y < proj.h; y++) if (rows[y] > max) { max = rows[y]; peak = y; }
  if (!max) return null;
  let base = peak;
  for (let y = proj.h - 1; y >= 0; y--) {
    if (rows[y] >= 0.25 * max) { base = y; break; }
  }
  let top = peak;
  while (top > 0 && rows[top - 1]) top--;
  let bottom = Math.max(peak, base);
  while (bottom < proj.h - 1 && rows[bottom + 1]) bottom++;
  return { base: proj.y0 + base + 1, top: proj.y0 + top, bottom: proj.y0 + bottom + 1 };
}

function inkHeight(proj) {
  if (proj.top < 0) return 0;
  return proj.bottom - proj.top + 1;
}

// One det line box → word segments in page pixels, or null when the box has no usable ink.
// gapRatio is the break threshold as a share of the line's ink height.
export function segmentLine(mask, pageW, pageH, box, { gapRatio = 0.35, minGapPx = 2 } = {}) {
  const proj = inkProjection(mask, pageW, pageH, box);
  if (!proj) return null;
  const inkH = inkHeight(proj);
  if (inkH < 3) return null;
  const minGap = Math.max(minGapPx, Math.round(gapRatio * inkH));
  const minInk = Math.max(2, Math.round(0.02 * inkH * inkH));
  const runs = inkRuns(proj.cols, minGap, minInk);
  if (!runs.length) return null;
  const segments = runs.map((run) => ({
    x0: proj.x0 + run.x0,
    x1: proj.x0 + run.x1,
    y0: proj.y0,
    y1: proj.y0 + proj.h,
    cols: [run.x0, run.x1],
    ink: inkRows(mask, pageW, proj, run.x0, run.x1),
  }));
  return { proj, inkH, minGap, segments };
}

// CTC spaces inside one segment → word edges snapped to the projection's inner gaps.
// groups: [{ text, c0, c1 }] with c0/c1 the group's first/last frame mapped to proj columns.
// seg: { cols: [c0, c1] } in proj columns. Returns [{ text, x0, x1 }] in page pixels.
export function snapWords(groups, seg, proj) {
  const [c0, c1] = seg.cols;
  if (groups.length <= 1) {
    return groups.map((g) => ({ text: g.text, x0: proj.x0 + c0, x1: proj.x0 + c1 }));
  }
  const span = c1 - c0;
  const gaps = innerGaps(proj.cols, c0, c1);
  const cuts = [];
  const used = new Set();
  for (let i = 1; i < groups.length; i++) {
    const want = (groups[i - 1].c1 + groups[i].c0) / 2;
    let best = -1;
    let bestD = Infinity;
    gaps.forEach((gap, k) => {
      if (used.has(k)) return;
      const mid = (gap.x0 + gap.x1) / 2;
      const d = Math.abs(mid - want) - 0.25 * gap.w;
      if (d < bestD) { bestD = d; best = k; }
    });
    if (best >= 0 && bestD <= Math.max(6, 0.12 * span)) {
      used.add(best);
      cuts.push({ x0: gaps[best].x0, x1: gaps[best].x1 });
    } else {
      const x = Math.round(want);
      cuts.push({ x0: x, x1: x });
    }
  }
  cuts.sort((a, b) => a.x0 - b.x0);
  const words = [];
  let from = c0;
  groups.forEach((g, i) => {
    const to = i < cuts.length ? cuts[i].x0 : c1;
    words.push({ text: g.text, x0: proj.x0 + from, x1: proj.x0 + Math.max(from + 1, to) });
    if (i < cuts.length) from = cuts[i].x1;
  });
  return words;
}

// Font size (pt) from the ink height of a read segment, the scale Vision reports: ascender to
// descender is ~0.95 em, cap or digit height ~0.7 em. x-height-only text ("one") says too
// little and returns null, so the caller keeps the det box height.
export function sizeFromInk(text, inkH) {
  if (!(inkH > 0)) return null;
  if (/[gjpqy,;()[\]{}|]/.test(text) && /[A-Z0-9bdfhklt]/.test(text)) return inkH / 0.95;
  if (/[A-Z0-9bdfhklt]/.test(text)) return inkH / 0.7;
  return null;
}

// Dash-shaped column runs between glyphs, in proj columns. The English rec has no en dash and
// reads "$9,595–$17,992" as "$9,595$17,992"; the ink still shows the dash. A dash column carries
// ink only in a thin band between 0.15 and 0.65 of the cap height above the baseline.
// base: baseline row (page px); capH: cap height in px.
export function dashRuns(mask, pageW, proj, c0, c1, base, capH) {
  if (!(capH > 4)) return [];
  const lo = base - 0.65 * capH;
  const hi = base - 0.15 * capH;
  const kind = new Uint8Array(c1 - c0);
  for (let x = c0; x < c1; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < proj.h; y++) {
      if (proj.ruleRow[y]) continue;
      if (mask[(proj.y0 + y) * pageW + proj.x0 + x]) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) { kind[x - c0] = 0; continue; }
    const yTop = proj.y0 + top;
    const yBot = proj.y0 + bottom + 1;
    kind[x - c0] = yTop >= lo && yBot <= hi && yBot - yTop <= 0.25 * capH ? 2 : 1;
  }
  const runs = [];
  let start = -1;
  for (let i = 0; i <= kind.length; i++) {
    if (i < kind.length && kind[i] === 2) { if (start < 0) start = i; continue; }
    if (start < 0) continue;
    const end = i;
    // An H crossbar or a "4" bar touches its stems; a dash stands apart from both neighbours.
    const apart = start > 0 && kind[start - 1] === 0 && end < kind.length && kind[end] === 0;
    const left = kind.slice(Math.max(0, start - Math.ceil(0.4 * capH)), start).some((k) => k === 1);
    const right = kind.slice(end, end + Math.ceil(0.4 * capH)).some((k) => k === 1);
    if (apart && end - start >= 0.3 * capH && left && right) runs.push({ c0: c0 + start, c1: c0 + end });
    start = -1;
  }
  return runs;
}

// Thousands groups the rec model split after a comma ("348," "928"): join two words of one
// segment when the left is a number ending in a comma or point, the right is a three-digit
// group, and the ink gap between them is under maxGap pixels. "21," "2010" stays apart. words: [{ text, x0, x1, conf }].
export function joinNumberWords(words, maxGap) {
  const out = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && /\d[,.]$/.test(prev.text) && /^\d{3}(?:[,.]\d+)*,?$/.test(word.text) && /^[$€£(]?[\d,.]+$/.test(prev.text)
      && word.x0 - prev.x1 <= maxGap) {
      prev.text += word.text;
      prev.x1 = word.x1;
      prev.conf = Math.min(prev.conf, word.conf);
      continue;
    }
    out.push({ ...word });
  }
  return out;
}

// Re-binarise one det box with its own Otsu threshold, written into the page mask. A page-wide
// threshold marks a blue or grey cell fill as ink, and the whole cell becomes one dark run.
// Low-contrast boxes (class means under minContrast apart) are left as the page mask had them.
export function localMask(gray, mask, pageW, pageH, box, minContrast = 60) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(pageW, Math.ceil(box.x1));
  const y1 = Math.min(pageH, Math.ceil(box.y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return false;
  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * pageW + x]]++;
  const total = (x1 - x0) * (y1 - y0);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thresh = 0;
  let meanDark = 0;
  let meanLight = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thresh = t; meanDark = mB; meanLight = mF; }
  }
  if (meanLight - meanDark < minContrast) return false;
  for (let y = y0; y < y1; y++) {
    const row = y * pageW;
    for (let x = x0; x < x1; x++) mask[row + x] = gray[row + x] <= thresh ? 1 : 0;
  }
  return true;
}
