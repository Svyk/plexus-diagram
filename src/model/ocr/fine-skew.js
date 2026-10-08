// Fine deskew from word baselines. The det-box angle is coarse (a box's minimum-area angle
// moves in steps, and a page reads 0.1–0.2° off); the per-word ink baselines along a long
// text row give the residual. Pure.

// Rows of words whose baselines chain within a fraction of the size, left to right.
function rowsOf(items) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  const rows = [];
  for (const it of sorted) {
    const size = it.transform[0];
    const base = it.transform[5];
    let best = null;
    for (const row of rows) {
      const last = row[row.length - 1];
      if (it.transform[4] < last.transform[4] + last.width - 0.5) continue;
      const d = Math.abs(last.transform[5] - base);
      if (d <= 0.3 * Math.max(size, last.transform[0]) && (!best || d < best.d)) best = { row, d };
    }
    if (best) best.row.push(it);
    else rows.push([it]);
  }
  return rows;
}

// Residual skew in degrees (image frame, y down, positive = baseline falls to the right).
// Rows of 3+ words spanning `minSpan` points vote with their least-squares slope, weighted by
// span; null when fewer than `minRows` rows qualify.
export function baselineSkew(items, { minSpan = 150, minWords = 3, minRows = 3 } = {}) {
  const votes = [];
  for (const row of rowsOf(items.filter((it) => it.str && it.str.trim()))) {
    if (row.length < minWords) continue;
    const xs = row.map((it) => it.transform[4] + it.width / 2);
    const span = Math.max(...row.map((it) => it.transform[4] + it.width)) - Math.min(...row.map((it) => it.transform[4]));
    if (span < minSpan) continue;
    const ys = row.map((it) => it.transform[5]);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    if (!sxx) continue;
    votes.push({ a: Math.atan(sxy / sxx) * 180 / Math.PI, w: span });
  }
  if (votes.length < minRows) return null;
  votes.sort((p, q) => p.a - q.a);
  const total = votes.reduce((s, v) => s + v.w, 0);
  let acc = 0;
  for (const v of votes) {
    acc += v.w;
    if (acc >= total / 2) return v.a;
  }
  return votes[votes.length - 1].a;
}

// Moves word items into the frame of rotateRgb(image, w, h, degrees): the baseline start of
// each word turns about the image centre (pixel space), its size and width stay.
export function rotateItems(items, degrees, w, h, scaleX, scaleY) {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const it of items) {
    const dx = it.transform[4] * scaleX - cx;
    const dy = it.transform[5] * scaleY - cy;
    const x = (cx + dx * cos + dy * sin) / scaleX;
    const base = (cy - dx * sin + dy * cos) / scaleY;
    const shift = base - it.transform[5];
    it.transform[4] = r2(x);
    it.transform[5] = r2(base);
    if (Number.isFinite(it.y0)) it.y0 = r2(it.y0 + shift);
    if (Number.isFinite(it.y1)) it.y1 = r2(it.y1 + shift);
  }
  return items;
}
