// Open on board from a Roam zoom. Pure camera math and the wait. The view unfolds and paints.

export const READABLE_PX = 96;
export const DETAIL_ZOOM = 0.5;
export const ZOOM_BUDGET_MS = 2000;
export const ZOOM_TICK_MS = 50;
const MAX_ZOOM = 4;

// Centre `rect` and zoom in until both screen axes are readable and the zoom is at least detail.
// A card that is already readable keeps its zoom. Never zooms out.
export function cameraForCard(vp, rect, size, opts = {}) {
  const minPx = Number(opts.minPx) > 0 ? Number(opts.minPx) : READABLE_PX;
  const detail = Number(opts.detail) > 0 ? Number(opts.detail) : DETAIL_ZOOM;
  const maxZoom = Number(opts.maxZoom) > 0 ? Number(opts.maxZoom) : MAX_ZOOM;
  const width = Number(size?.width);
  const height = Number(size?.height);
  const w = Number(rect?.w);
  const h = Number(rect?.h);
  const zoom0 = Number(vp?.zoom) > 0 ? Number(vp.zoom) : 1;
  if (!(width > 0) || !(height > 0) || !(w > 0) || !(h > 0)) return null;
  const cx = Number(rect.x) + w / 2;
  const cy = Number(rect.y) + h / 2;
  const readable = w * zoom0 >= minPx - 0.5 && h * zoom0 >= minPx - 0.5 && zoom0 >= detail - 1e-9;
  const zoom = readable
    ? zoom0
    : Math.min(maxZoom, Math.max(zoom0, detail, minPx / h, minPx / w));
  const x = width / 2 - cx * zoom;
  const y = height / 2 - cy * zoom;
  const dx = Math.abs(x - (Number(vp?.x) || 0));
  const dy = Math.abs(y - (Number(vp?.y) || 0));
  if (zoom === zoom0 && dx < 1 && dy < 1) return null;
  return { x, y, zoom };
}

const aimCard = (io, cardUid) => {
  let vp = null;
  let rect = null;
  let box = null;
  try { vp = io.camera?.() || null; } catch { vp = null; }
  try { rect = io.cardRect?.(cardUid) || null; } catch { rect = null; }
  try { box = io.size?.() || null; } catch { box = null; }
  const next = cameraForCard(vp, rect, box);
  if (!next) return;
  try { io.applyCamera?.(next); } catch { /* view */ }
};

// Open the board when it is not the mounted page, zoom to a readable size, unfold until the
// child row is in the DOM or the clock runs out, then focus and centre. `now` and `wait` are injected.
export async function revealZoomedBlock(target, io = {}) {
  const boardUid = target?.boardUid;
  const cardUid = target?.cardUid;
  const blockUid = String(target?.blockUid || "") || cardUid;
  if (!boardUid || !cardUid || !blockUid) return false;
  const now = typeof io.now === "function" ? io.now : () => Date.now();
  const budget = Number(io.budgetMs) > 0 ? Number(io.budgetMs) : ZOOM_BUDGET_MS;
  const tick = Number(io.tickMs) > 0 ? Number(io.tickMs) : ZOOM_TICK_MS;
  let mounted = "";
  try { mounted = typeof io.mountedBoard === "function" ? io.mountedBoard() : boardUid; } catch { mounted = ""; }
  if (mounted !== boardUid) {
    try { await io.openBoard?.(boardUid); } catch { return false; }
    if (io.stopped?.()) return false;
  }
  aimCard(io, cardUid);
  if (io.stopped?.()) return false;
  const child = blockUid !== cardUid;
  if (child) {
    const start = now();
    let seen = false;
    while (true) {
      if (io.stopped?.()) return false;
      try { io.unfold?.(cardUid, blockUid); } catch { /* view */ }
      let ready = false;
      try { ready = io.rowMounted?.(cardUid, blockUid) === true; } catch { ready = false; }
      if (ready) { seen = true; break; }
      if (now() - start >= budget || typeof io.wait !== "function") break;
      await io.wait(tick);
    }
    if (!seen) return false;
  } else {
    try { io.unfold?.(cardUid, blockUid); } catch { /* view */ }
    if (io.stopped?.()) return false;
  }
  try { io.focus?.(cardUid, blockUid); } catch { /* view */ }
  try { io.centre?.(cardUid); } catch { /* view */ }
  return true;
}
