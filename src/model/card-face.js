// Small pure rules behind the PDF card face, Quick Look, the stacked reader and the context bar.

// "1 ref", "2 refs". Non-numbers and negatives count as 0.
export function countText(n, one, many) {
  const raw = Number(n);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return `${count} ${count === 1 ? one : many}`;
}

// The in-card page bar shows ‹ › only when there is somewhere to go.
export function flipArrowsShown(total) {
  const raw = Number(total);
  return Number.isFinite(raw) && raw > 1;
}

// The minimap needs a board area of at least 420 × 280 screen px; below that it would sit on the cards.
export const MINIMAP_MIN_W = 420;
export const MINIMAP_MIN_H = 280;
export function boardCramped(area) {
  const w = Number(area?.width);
  const h = Number(area?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return w < MINIMAP_MIN_W || h < MINIMAP_MIN_H;
}

// The board area the cards can use: the viewport rect minus the board bar on top of it (when the bar overlaps it).
export function freeBoardArea(viewport, toolbar) {
  const w = Number(viewport?.width) || 0;
  const h = Number(viewport?.height) || 0;
  const top = Number(viewport?.top) || 0;
  const barBottom = Number(toolbar?.bottom);
  const barH = Number(toolbar?.height) || 0;
  const covered = barH > 0 && Number.isFinite(barBottom) && barBottom > top ? Math.min(h, barBottom - top) : 0;
  return { width: w, height: Math.max(0, h - covered) };
}

// The open reader as an obstacle for the context bar, in root-relative px. Beside the board it is a right edge
// ({ right }); stacked under the board it is a bottom edge ({ bottom }). No reader, no limit.
export function readerLimit(rootRect, readRect) {
  const rl = Number(rootRect?.left) || 0;
  const rt = Number(rootRect?.top) || 0;
  const rw = Number(rootRect?.width) || 0;
  const w = Number(readRect?.width) || 0;
  const h = Number(readRect?.height) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const left = (Number(readRect.left) || 0) - rl;
  const top = (Number(readRect.top) || 0) - rt;
  // A pane that starts at the root's left edge and spans its width sits below the board, not beside it.
  if (left <= 8 && w >= rw - 8) return { bottom: top };
  return { right: left };
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Where the context bar goes so it never covers the tool dock. `bar` is { left, top, w, h } in root px,
// `card` the anchor rect { x, y, w, h }, `dock` the dock rect { left, top, right, bottom } (or null), `gap` the
// card gap, `topLimit` the lowest allowed top. Above the card first, then clear above the dock, else unchanged.
export function avoidDock(bar, { card, dock, gap = 10, topLimit = 0, margin = 8 } = {}) {
  if (!bar || !dock) return bar;
  const box = (b) => ({ left: b.left, top: b.top, right: b.left + b.w, bottom: b.top + b.h });
  if (!overlaps(box(bar), dock)) return bar;
  if (card) {
    const above = card.y - gap - bar.h;
    if (above >= topLimit) {
      const next = { ...bar, top: above };
      if (!overlaps(box(next), dock)) return next;
    }
  }
  const hop = dock.top - margin - bar.h;
  if (hop >= topLimit) return { ...bar, top: hop };
  return bar;
}

// Where the context bar goes so it covers none of `obstacles` (dock, minimap, zoom rail), each { left, top, right, bottom }
// in root px. `bar` is { left, top, w, h }; `bounds` { right, bottom } the free area's far edges. Tries, per overlap, left of
// the obstacle, then above it, then below it, and keeps the first spot that clears every obstacle. Unchanged when
// nothing fits, or when nothing overlaps.
export function avoidObstacles(bar, obstacles, { topLimit = 0, margin = 8, bounds = {} } = {}) {
  const list = (obstacles || []).filter((o) => o && o.right > o.left && o.bottom > o.top);
  if (!bar || !list.length) return bar;
  const box = (b) => ({ left: b.left, top: b.top, right: b.left + b.w, bottom: b.top + b.h });
  const clear = (b) => !list.some((o) => overlaps(box(b), o));
  const fits = (b) => b.left >= margin && b.top >= topLimit
    && (bounds.right == null || b.left + b.w <= bounds.right)
    && (bounds.bottom == null || b.top + b.h <= bounds.bottom);
  if (clear(bar)) return bar;
  let cur = bar;
  for (let pass = 0; pass < 4; pass += 1) {
    const hit = list.find((o) => overlaps(box(cur), o));
    if (!hit) return cur;
    const options = [
      { ...cur, left: hit.left - margin - cur.w },
      { ...cur, top: hit.top - margin - cur.h },
      { ...cur, top: hit.bottom + margin },
    ];
    const whole = options.find((o) => fits(o) && clear(o));
    if (whole) return whole;
    const part = options.find((o) => fits(o) && !overlaps(box(o), hit));
    if (!part) return bar;
    cur = part;
  }
  return clear(cur) ? cur : bar;
}

// A softer pass for the arrow bar: when it lands on a card (cards are given with their connect ports and the bar's
// hover bridges already added), try the spots in `alts` and beside each card it covers, nearest first, at most
// `reach` px away. Hard obstacles and the bounds still win. When no spot is free the bar stays where it was.
export function avoidSoft(bar, soft, hard, { alts = [], topLimit = 0, margin = 8, bounds = {}, reach = 240 } = {}) {
  const valid = (o) => o && o.right > o.left && o.bottom > o.top;
  const cards = (soft || []).filter(valid);
  if (!bar || !cards.length) return bar;
  const walls = (hard || []).filter(valid);
  const box = (b) => ({ left: b.left, top: b.top, right: b.left + b.w, bottom: b.top + b.h });
  const hits = (b, list) => list.some((o) => overlaps(box(b), o));
  if (!hits(bar, cards)) return bar;
  const fits = (b) => b.left >= margin && b.top >= topLimit
    && (bounds.right == null || b.left + b.w <= bounds.right)
    && (bounds.bottom == null || b.top + b.h <= bounds.bottom);
  const spots = [];
  for (const a of [bar, ...(alts || [])]) {
    const at = { ...bar, ...a };
    spots.push(at);
    for (const o of cards) {
      if (!overlaps(box(at), o)) continue;
      spots.push(
        { ...at, left: o.left - margin - at.w },
        { ...at, left: o.right + margin },
        { ...at, top: o.top - margin - at.h },
        { ...at, top: o.bottom + margin },
      );
    }
  }
  const far = (b) => Math.hypot(b.left - bar.left, b.top - bar.top);
  const ok = spots.filter((b) => far(b) <= reach && fits(b) && !hits(b, walls) && !hits(b, cards));
  if (!ok.length) return bar;
  ok.sort((p, q) => far(p) - far(q));
  return ok[0];
}

// Which dock tools stay in the row. `widths` are the tools' widths in order, `avail` the room the row has, `gap` the
// space between tools, `pad` the bar's padding and border, `more` the width of the "…" button, `keep` an index that
// never moves behind it (the active tool). Returns the indices that go behind "…", trailing tools first.
// Nothing hides when everything fits.
export function dockOverflow(widths, avail, { gap = 4, pad = 14, more = 32, keep = -1 } = {}) {
  const w = (widths || []).map((n) => Math.max(0, Number(n) || 0));
  const total = (idx) => idx.reduce((sum, i) => sum + w[i], 0) + gap * Math.max(0, idx.length - 1);
  const all = w.map((_, i) => i);
  if (pad + total(all) <= avail) return [];
  const shown = [...all];
  const hidden = [];
  while (shown.length > 1 && pad + total(shown) + gap + more > avail) {
    let at = shown.length - 1;
    while (at >= 0 && shown[at] === keep) at -= 1;
    if (at < 0) break;
    hidden.unshift(shown.splice(at, 1)[0]);
  }
  return hidden;
}

// Quick Look and the card title: a display title, never the raw {{[[pdf]]: …}} macro or a ((ref)).
export function quickLookTitle(item, displayTitle) {
  const shown = typeof displayTitle === "string" ? displayTitle.trim() : "";
  if (shown && !shown.startsWith("{{") && !shown.startsWith("((")) return shown;
  const title = typeof item?.title === "string" ? item.title.trim() : "";
  if (title && !title.startsWith("{{") && !title.startsWith("((")) return title;
  const text = typeof item?.string === "string" ? item.string.trim() : "";
  if (text && !text.startsWith("{{") && !text.startsWith("((")) return text;
  return item?.kind === "pdf" ? "PDF" : text;
}

// The page Quick Look and Open start on: the card's flipped page, else 1, clamped to the document.
export function startPage(cardPage, total) {
  const n = Math.floor(Number(cardPage));
  const t = Math.floor(Number(total));
  const at = Number.isFinite(n) && n >= 1 ? n : 1;
  return Number.isFinite(t) && t >= 1 ? Math.min(at, t) : at;
}

// How far (world px) a PDF card's bottom controls rise so floating chrome (the tool dock, the context bar) does
// not cover them. `card` is the card's screen rect { left, top, w, h }; `obstacles` one screen rect or a list of
// them ({ left, top, right, bottom }); `zoom` the board zoom; `clipBottom` where the visible board area ends.
// Obstacles stacked on the card's bottom edge add up.
// 0 when nothing sits on the bottom edge, or when rising would go above the top 35% of the card (96 screen px at
// most, so a tall card in a short board still shows its controls under the header).
export function pdfDockLift(card, obstacles, zoom = 1, { clipBottom = Infinity } = {}) {
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  const left = Number(card?.left) || 0;
  const top = Number(card?.top) || 0;
  const w = Number(card?.w) || 0;
  const h = Number(card?.h) || 0;
  const list = (Array.isArray(obstacles) ? obstacles : [obstacles]).filter((r) => r && r.right > left && r.left < left + w);
  if (!(w > 0) || !(h > 0)) return 0;
  const bottom = top + h;
  const floor = top + Math.min(h * 0.35, 96);
  // The board area may end above the card (a stacked reader): the controls stay in the visible part.
  const clip = Number(clipBottom);
  let edge = Number.isFinite(clip) && clip < bottom ? clip - 6 : bottom;
  for (let pass = 0; pass < list.length; pass += 1) {
    let moved = false;
    for (const r of list) {
      if (r.top < edge && r.bottom > edge - 12 && r.top < bottom) {
        edge = r.top - 6;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (edge >= bottom) return 0;
  if (edge < floor) return 0;
  return Math.round((bottom - edge) / z);
}
