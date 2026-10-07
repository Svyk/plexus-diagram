// PDF-U1 cover plan. Pure. No DOM, no store, no graph write.
// A bad argument degrades to an empty result. Nothing here throws.

export const WARM_AFTER_MS = 1500;
export const WARM_MAX = 3;
export const COVER_MAX_W = 320;
export const SHARP_CAP = 1600;

function imageOf(value) {
  if (typeof value === "string") return value.length > 0;
  if (!value || typeof value !== "object") return false;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size > 0;
  return typeof value.size === "number" && value.size > 0;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function whole(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function visibleHas(visible, uid) {
  if (visible == null) return false;
  if (typeof visible === "function") {
    try { return visible(uid) === true; } catch { return false; }
  }
  if (typeof visible.has === "function") {
    try { return visible.has(uid) === true; } catch { return false; }
  }
  if (Array.isArray(visible)) return visible.includes(uid);
  return false;
}

// The cache key is the pdf url itself, including an .enc query. Not the macro.
export function coverKey(url) {
  try { return text(url); } catch { return ""; }
}

// A stored hash that differs from the page hash is stale.
// A missing hash on either side is not a mismatch: the query may not carry one yet.
export function coverValid(record, hash) {
  try {
    if (!record || typeof record !== "object") return false;
    if (!imageOf(record.first) && !imageOf(record.last)) return false;
    const want = text(hash);
    const got = text(record.hash);
    if (want && got && want !== got) return false;
    return true;
  } catch {
    return false;
  }
}

// Draw the page at exactly maxW pixels wide, scaling a PDF-point viewport up
// when the card on screen is wider than that viewport. Capped at 1600.
export function sharpBox(w, h, maxW = SHARP_CAP) {
  try {
    const width = Number(w);
    const height = Number(h);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    const cap = Number(maxW);
    const limit = Number.isFinite(cap) && cap > 0 ? Math.min(cap, SHARP_CAP) : COVER_MAX_W;
    const targetH = height * (limit / width);
    return {
      w: Math.max(1, Math.round(limit)),
      h: Math.max(1, Math.round(targetH)),
    };
  } catch {
    return null;
  }
}

// Fit inside maxW wide. Do not scale a smaller canvas up.
// 512×688 (the measured fit backing size) becomes 320×430.
export function scaleBox(w, h, maxW = COVER_MAX_W) {
  try {
    const width = Number(w);
    const height = Number(h);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    const cap = Number(maxW);
    const limit = Number.isFinite(cap) && cap > 0 ? cap : COVER_MAX_W;
    const targetW = Math.min(width, limit);
    const targetH = height * (targetW / width);
    return {
      w: Math.max(1, Math.round(targetW)),
      h: Math.max(1, Math.round(targetH)),
    };
  } catch {
    return null;
  }
}

// A sharper page-1 render, or null when the stored cover already covers the screen.
// maxW is capped at 1600. The caller keeps that bitmap in memory only.
export function sharpCoverPlan(input) {
  try {
    const src = input && typeof input === "object" ? input : {};
    const cardW = Number(src.cardW);
    if (!Number.isFinite(cardW) || cardW <= 0) return null;
    const zoom = Number(src.zoom);
    const dpr = Number(src.dpr);
    const zoomN = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const dprN = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const pixels = cardW * zoomN * dprN;
    const stored = Number(src.coverW);
    const have = Number.isFinite(stored) && stored > 0 ? stored : 0;
    if (pixels <= have + 1) return null;
    const maxW = Math.min(SHARP_CAP, Math.ceil(pixels));
    if (!(maxW > have)) return null;
    return { maxW };
  } catch {
    return null;
  }
}

// One card, or null. Never during the open window, never beside a live reader
// or an open pane, never while another warm is in flight, never past 3,
// never on save-data, never while the camera is moving.
// `visible` is a Set, a list of uids, or (uid) => boolean. Omit it and nothing warms.
// `moving` is optional; the integrator passes true during pan or zoom.
export function warmPlan(input) {
  try {
    const src = input && typeof input === "object" ? input : {};
    if (src.hasLive || src.hasPane || src.saveData || src.inFlight || src.moving) return null;
    const since = Number(src.sinceOpenMs);
    if (!Number.isFinite(since) || since < WARM_AFTER_MS) return null;
    const done = Number(src.done);
    if (!Number.isFinite(done) || done < 0 || done >= WARM_MAX) return null;
    const cards = Array.isArray(src.cards) ? src.cards : [];
    for (const card of cards) {
      if (!card || typeof card !== "object") continue;
      if (card.kind && card.kind !== "pdf") continue;
      if (card.hasCover) continue;
      const uid = text(card.uid);
      const blockUid = text(card.blockUid);
      if (!uid || !blockUid) continue;
      if (!visibleHas(src.visible, uid)) continue;
      return { uid, blockUid };
    }
    return null;
  } catch {
    return null;
  }
}

function pageOf(row) {
  const direct = whole(row.page);
  if (direct) return direct;
  const nested = row.highlight && typeof row.highlight === "object" ? whole(row.highlight.page) : null;
  return nested;
}

function colorOf(row) {
  const direct = row.color;
  if (typeof direct === "string") return direct;
  const nested = row.highlight && typeof row.highlight === "object" ? row.highlight.color : "";
  return typeof nested === "string" ? nested : "";
}

// One tick per highlight. y01 is (page − 1) / pageCount, top of the strip at 0.
export function densityTicks(rows, pageCount) {
  try {
    const total = whole(pageCount);
    if (!total || !Array.isArray(rows)) return [];
    const out = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const page = pageOf(row);
      if (!page || page > total) continue;
      out.push({ y01: (page - 1) / total, color: colorOf(row) });
    }
    return out;
  } catch {
    return [];
  }
}

function warmStatus(warm) {
  if (warm === true) return "loading";
  if (typeof warm === "string") return warm;
  if (warm && typeof warm === "object") {
    if (typeof warm.status === "string") return warm.status;
    if (warm.loading) return "loading";
    if (warm.error) return "error";
  }
  return "";
}

// ready when a record has an image. Otherwise loading, error, or none.
export function coverState(record, warm) {
  try {
    if (record && typeof record === "object" && (imageOf(record.first) || imageOf(record.last))) return "ready";
    const status = warmStatus(warm);
    if (status === "loading") return "loading";
    if (status === "error") return "error";
    return "none";
  } catch {
    return "none";
  }
}

// P32 live fix. A page captured before pdf.js painted it is all white; such a snapshot must not replace a cover.
// Samples a 12×16 grid; any pixel darker than the threshold means the page has ink.
export function isBlankCanvas(canvas, { threshold = 235 } = {}) {
  try {
    const w = Number(canvas?.width) || 0;
    const h = Number(canvas?.height) || 0;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx || typeof ctx.getImageData !== "function" || w < 2 || h < 2) return false;
    for (let gy = 0; gy < 16; gy += 1) {
      for (let gx = 0; gx < 12; gx += 1) {
        const x = Math.min(w - 1, Math.floor(((gx + 0.5) * w) / 12));
        const y = Math.min(h - 1, Math.floor(((gy + 0.5) * h) / 16));
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[0] < threshold || d[1] < threshold || d[2] < threshold) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
