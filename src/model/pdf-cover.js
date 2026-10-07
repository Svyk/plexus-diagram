// PDF-U1 cover plan. Pure. No DOM, no store, no graph write.
// A bad argument degrades to an empty result. Nothing here throws.

export const WARM_AFTER_MS = 1500;
export const WARM_MAX = 3;
export const COVER_MAX_W = 320;

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
