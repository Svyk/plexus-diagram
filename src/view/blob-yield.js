import { sharedBgBudget } from "../bg-budget.js";
import { notedSpeedFlags } from "../settings.js";

const HOLD_WAIT_MS = 32;
const HOLD_CAP_MS = 2000;
// Captured at load. PDF tests replace only the timers object they pass in; a later
// global setTimeout must not be the one that resolves the blob.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

export function continueAfterBlob(fn, { setTimer = realSetTimeout, now = () => Date.now(), held } = {}) {
  if (notedSpeedFlags().gestureJobs === false) { fn(); return; }
  const isHeld = typeof held === "function" ? held : () => {
    try { return sharedBgBudget().held(); } catch { return false; }
  };
  const start = now();
  const go = () => {
    let waiting = false;
    try { waiting = Boolean(isHeld()) && now() - start < HOLD_CAP_MS; } catch { waiting = false; }
    if (waiting) { setTimer(go, HOLD_WAIT_MS); return; }
    fn();
  };
  setTimer(go, 0);
}
