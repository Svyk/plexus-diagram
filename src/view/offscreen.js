// PERF-2 and PERF-3. Pure decisions. The board view applies them.
// A card outside the camera, plus one screen of margin, keeps a sized shell
// and skips layout. An editing card stays fully rendered.

export const UNMOUNT_GRACE_MS = 10000;

export function boardKeyIsOutside(target, hasSelection) {
  if (hasSelection) return false;
  if (!target || typeof target.closest !== "function") return false;
  return target.closest(".pxd-root") == null;
}

export function intrinsicSize(rect) {
  const w = Math.max(0, Math.round(Number(rect?.w) || 0));
  const h = Math.max(0, Math.round(Number(rect?.h) || 0));
  return `${w}px ${h}px`;
}

export function rectMisses(rect, view) {
  if (!rect || !view) return false;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return right <= view.x || view.x + view.w <= rect.x || bottom <= view.y || view.y + view.h <= rect.y;
}

export function shellOffscreen(uid, rect, view, { editingUid = null } = {}) {
  if (!uid || uid === editingUid) return false;
  return rectMisses(rect, view);
}

export function unmountDue(seenAt, now, grace = UNMOUNT_GRACE_MS) {
  if (!Number.isFinite(seenAt) || !Number.isFinite(now)) return false;
  return now - seenAt >= grace;
}
