// INSTANT-4. A small PNG of a {{[[table]]}} card, drawn from the board model's cells
// (no DOM read, no Roam call). Shown at map and overview zoom and in the open snapshot,
// where the card used to be a grey "Table · N rows" box.

export const THUMB_W = 320;
export const THUMB_MAX = 480;
const ROW_H = 24;
const PAD = 7;

export function tableThumbKey(item, sig) {
  return item?.uid && sig ? `t:${item.uid}:${sig}` : "";
}

// Column widths in proportion to the longest text in each column, at least 40px.
export function columnWidths(grid, width = THUMB_W) {
  const cols = Math.max(0, ...grid.map((row) => row.length));
  if (!cols) return [];
  const want = [];
  for (let c = 0; c < cols; c += 1) {
    let n = 3;
    for (const row of grid) n = Math.max(n, Math.min(40, String(row[c] ?? "").length));
    want.push(n);
  }
  const total = want.reduce((a, b) => a + b, 0);
  const raw = want.map((n) => Math.max(40, (n / total) * width));
  const scale = width / raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w * scale);
}

function fit(g, text, max) {
  const s = String(text ?? "");
  if (!s || typeof g.measureText !== "function" || g.measureText(s).width <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.measureText(`${s.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${s.slice(0, lo)}…` : "";
}

// The PNG box for a card: its own aspect, at most THUMB_MAX on the long side.
export function thumbBox(item) {
  const w = Number(item?.w) > 0 ? Number(item.w) : THUMB_W;
  const h = Number(item?.h) > 0 ? Number(item.h) : 200;
  const k = Math.min(1, THUMB_MAX / Math.max(w, h));
  return { width: Math.max(120, Math.round(w * k)), height: Math.max(48, Math.round(h * k)) };
}

// Returns a PNG data URL, or "" when there is no canvas or nothing to draw.
// Rows past the box height are not drawn; the card's header already says how many there are.
export function renderTableThumb(doc, grid, { dark = false, width = THUMB_W, height: boxH = 0 } = {}) {
  if (!doc || !Array.isArray(grid) || !grid.length) return "";
  const widths = columnWidths(grid, width);
  if (!widths.length) return "";
  const height = Math.min(boxH > 0 ? boxH : grid.length * ROW_H + 1, grid.length * ROW_H + 1);
  let canvas;
  try { canvas = doc.createElement("canvas"); } catch { return ""; }
  const g = canvas?.getContext?.("2d");
  if (!g || typeof canvas.toDataURL !== "function") return "";
  const scale = 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  g.scale(scale, scale);
  const ink = dark ? "#d6dde4" : "#1f2937";
  const line = dark ? "#3a4450" : "#d0d7de";
  const head = dark ? "#26303a" : "#f3f4f6";
  g.fillStyle = dark ? "#1c232b" : "#ffffff";
  g.fillRect(0, 0, width, height);
  g.textBaseline = "middle";
  grid.forEach((row, r) => {
    const y = r * ROW_H;
    if (y >= height) return;
    if (r === 0) {
      g.fillStyle = head;
      g.fillRect(0, y, width, ROW_H);
    }
    g.font = `${r === 0 ? "600 " : ""}13px -apple-system, system-ui, sans-serif`;
    g.fillStyle = ink;
    let x = 0;
    widths.forEach((w, c) => {
      g.fillText(fit(g, row[c], w - PAD * 2), x + PAD, y + ROW_H / 2);
      x += w;
    });
  });
  g.strokeStyle = line;
  g.lineWidth = 1;
  g.beginPath();
  for (let r = 0; r <= grid.length && r * ROW_H <= height; r += 1) {
    const y = Math.min(height - 0.5, r * ROW_H + 0.5);
    g.moveTo(0, y);
    g.lineTo(width, y);
  }
  let x = 0;
  for (const w of widths) {
    const px = Math.min(width - 0.5, Math.round(x) + 0.5);
    g.moveTo(px, 0);
    g.lineTo(px, height);
    x += w;
  }
  g.moveTo(width - 0.5, 0);
  g.lineTo(width - 0.5, height);
  g.stroke();
  try {
    const url = canvas.toDataURL("image/png");
    return typeof url === "string" && url.startsWith("data:image/png") ? url : "";
  } catch { return ""; }
}
