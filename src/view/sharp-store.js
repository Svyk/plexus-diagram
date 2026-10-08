// Sharp PDF covers: one board-owned blob URL per PDF, a generation token per URL so only the newest
// redraw paints, and a revoke that waits until the paint no longer references the old URL.
export const REVOKE_DELAY_MS = 4000;

export function createSharpStore({ revoke, later, delay = REVOKE_DELAY_MS } = {}) {
  const faces = new Map();
  const gens = new Map();
  const pending = new Set();
  const free = (src) => {
    if (typeof src !== "string" || !src.startsWith("blob:")) return;
    try { revoke?.(src); } catch { /* already revoked */ }
  };
  const retire = (src) => {
    if (typeof src !== "string" || !src.startsWith("blob:")) return;
    if (typeof later !== "function") return;
    const entry = { off: null };
    entry.off = later(() => { pending.delete(entry); free(src); }, delay);
    pending.add(entry);
  };
  return {
    get: (url) => faces.get(url),
    values: () => faces.values(),
    begin(url) {
      const next = (gens.get(url) || 0) + 1;
      gens.set(url, next);
      return next;
    },
    current: (url, token) => gens.get(url) === token,
    // A stale token frees its own URL at once (nothing painted it). The newest result replaces the
    // face, and the face it replaces is revoked only after the delay.
    commit(url, token, face) {
      if (gens.get(url) !== token) { free(face?.src); return false; }
      const prev = faces.get(url);
      faces.set(url, face);
      if (prev?.src && prev.src !== face?.src) retire(prev.src);
      return true;
    },
    // A failed redraw keeps the last good URL; the stored data-URL cover shows when there is none.
    fail(url, token, size) {
      if (gens.get(url) !== token) return false;
      const prev = faces.get(url);
      faces.set(url, { src: prev?.src || "", w: size, h: prev?.h || 0, failed: true });
      return true;
    },
    dispose() {
      for (const face of faces.values()) free(face?.src);
      faces.clear();
      gens.clear();
      for (const entry of pending) { try { entry.off?.(); } catch { /* timer */ } }
      pending.clear();
    },
  };
}
