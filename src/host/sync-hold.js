// Bulk writes wait between batches while Roam's own sync dot says it is saving. Roam confirms writes about one per
// second on a big page, and a long unconfirmed queue wedges the window. The only signal is the class on
// `.rm-sync__icon` (--saving-local, --saving-remote, --synced). Roam's IndexedDB is never opened: an open of a
// missing database creates an empty v1 one and Roam's upgrade then skips its unconfirmed-log.
export const SYNC_HOLD_BATCH = 100;
export const SYNC_HOLD_CAP_MS = 30000;
const POLL_MS = 250;
const ICON = ".rm-sync__icon";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSyncHold({
  doc = globalThis.document,
  sleep = delay,
  now = () => Date.now(),
  capMs = SYNC_HOLD_CAP_MS,
  online = () => globalThis.navigator?.onLine !== false,
} = {}) {
  // true: saving. false: synced. null: no dot to read.
  const saving = () => {
    let icon = null;
    try { icon = doc?.querySelector?.(ICON) || null; } catch { icon = null; }
    if (!icon) return null;
    const cls = typeof icon.className === "string" ? icon.className : String(icon.classList ?? "");
    return /saving/.test(cls);
  };

  // The beforeunload guard: installed at the first held wait, removed by release() (or at the end of a wait that did
  // not ask to keep it).
  const win = () => doc?.defaultView || null;
  const guard = (event) => { event.preventDefault?.(); try { event.returnValue = ""; } catch { /* read-only in some runtimes */ } };
  let guarded = null;
  const installGuard = () => {
    if (guarded) return;
    const w = win();
    try { w?.addEventListener?.("beforeunload", guard); guarded = w; } catch { /* no window */ }
  };
  const release = () => {
    const w = guarded;
    guarded = null;
    try { w?.removeEventListener?.("beforeunload", guard); } catch { /* gone */ }
  };

  // Resolves when the dot is not saving, the cap passes, `abort()` says so, or there is nothing to wait on. `onHold`
  // runs once, the first time it actually has to wait. `capMs` lowers the cap for this wait (the rest of a
  // transaction's budget). `keepGuard` leaves the beforeunload guard up for the caller to release().
  const wait = async ({ onHold, capMs: budget, abort, keepGuard = false } = {}) => {
    let state = saving();
    if (state !== true || !online()) return { waited: 0, capped: false, held: false };
    const cap = Math.min(capMs, Number.isFinite(budget) ? budget : capMs);
    onHold?.();
    installGuard();
    const start = now();
    let capped = false;
    try {
      while (state === true) {
        if (abort?.()) break;
        if (now() - start >= cap) { capped = true; break; }
        await sleep(POLL_MS);
        if (!online()) break;
        state = saving();
      }
    } finally {
      if (!keepGuard) release();
    }
    return { waited: now() - start, capped, held: true };
  };

  return { saving, wait, release };
}
