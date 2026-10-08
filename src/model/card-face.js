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
