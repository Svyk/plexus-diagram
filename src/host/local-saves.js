// PXD-9 F10: "this window just saved a block edit", so a followed query or linked references can read again without a
// pull per transaction (a reverse-ref watch on a page with 2,500 backlinks costs about 8 ms on every one). Every
// listener in a document shares one set of signals:
// - Typing in a block editor (`input`): heard at once, and again SAVE_LAG_MS after the last key. Roam writes typed
//   text about 0.7 s after a key, one write for every key before it, so a read at the first key can miss the last.
// - Leaving a block editor (`focusout`), a checkbox (`change`), a drop.
// - Roam's sync dot (`.rm-sync__icon`) changing class: writes that are not typing (a menu, an undo, an extension).
//   While Roam's sync is backed up the dot stays on saving and says little; the tray's poll is the backstop.
// Roam can draw the sync box again (a re-render, a theme change), and an observer on the old box hears nothing. Every
// DOT_CHECK_MS the hub asks whether its box is still in the page (no observer on the topbar or the document) and, if
// not, finds the dot again and fires once for any save made while it was deaf. Before the topbar is drawn there is
// no dot: the same check looks again.
export const SAVE_LAG_MS = 1000;
export const DOT_CHECK_MS = 1000;
const ICON = ".rm-sync__icon";
const SAVING = /saving/;
const hubs = new WeakMap();

const isEditor = (node) => node?.tagName === "TEXTAREA" && Boolean(node.classList?.contains?.("rm-block-input"));
const inBlock = (node) => Boolean(node?.closest?.(".roam-block, .rm-block"));

function fire(hub) {
  for (const cb of [...hub.subs]) {
    try { cb(); } catch { /* one listener cannot stop the rest */ }
  }
}

function watchDot(doc, hub) {
  if (hub.mo && hub.box?.isConnected !== false) return;
  // A box that was heard and is gone stays owed one signal until a new dot is found.
  hub.lost = hub.lost || Boolean(hub.mo);
  try { hub.mo?.disconnect?.(); } catch { /* gone */ }
  hub.mo = null;
  hub.box = null;
  let icon = null;
  try { icon = doc.querySelector?.(ICON) || null; } catch { icon = null; }
  const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (!icon || typeof MO !== "function") return;
  // The box, not the dot: a dot Roam draws again inside it is still heard.
  const box = icon.parentElement || icon;
  try {
    const mo = new MO((records) => {
      // A save that starts and ends within one batch leaves the dot synced; its old value still says saving.
      const hit = records.some((r) => r?.target?.classList?.contains?.("rm-sync__icon")
        && (SAVING.test(String(r.oldValue || "")) || SAVING.test(String(r.target.className || ""))));
      if (hit) fire(hub);
    });
    mo.observe(box, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
    hub.mo = mo;
    hub.box = box;
  } catch {
    hub.mo = null;
  }
  if (hub.lost && hub.mo) {
    hub.lost = false;
    fire(hub);
  }
}

function start(doc, hub) {
  const win = doc.defaultView || globalThis;
  hub.onInput = (event) => {
    if (!isEditor(event?.target)) return;
    fire(hub);
    if (hub.lag) win.clearTimeout(hub.lag);
    hub.lag = win.setTimeout(() => { hub.lag = null; fire(hub); }, SAVE_LAG_MS);
  };
  hub.onDone = (event) => {
    if (event?.type === "focusout" && !isEditor(event.target)) return;
    if (event?.type === "change" && !inBlock(event.target)) return;
    fire(hub);
  };
  const check = () => {
    hub.check = win.setTimeout(check, DOT_CHECK_MS);
    watchDot(doc, hub);
  };
  hub.stop = () => {
    doc.removeEventListener?.("input", hub.onInput, true);
    for (const type of ["focusout", "change", "drop"]) doc.removeEventListener?.(type, hub.onDone, true);
    if (hub.lag) win.clearTimeout(hub.lag);
    hub.lag = null;
    if (hub.check) win.clearTimeout(hub.check);
    hub.check = null;
    hub.lost = false;
    try { hub.mo?.disconnect?.(); } catch { /* gone */ }
    hub.mo = null;
    hub.box = null;
    hub.stop = null;
  };
  doc.addEventListener?.("input", hub.onInput, true);
  for (const type of ["focusout", "change", "drop"]) doc.addEventListener?.(type, hub.onDone, true);
  hub.check = win.setTimeout(check, DOT_CHECK_MS);
}

export function watchLocalSaves(doc, cb) {
  if (!doc || typeof cb !== "function") return () => {};
  let hub = hubs.get(doc);
  if (!hub) {
    hub = { subs: new Set(), mo: null, box: null, lag: null, check: null, lost: false, stop: null };
    hubs.set(doc, hub);
  }
  const token = () => cb();
  hub.subs.add(token);
  if (!hub.stop) start(doc, hub);
  watchDot(doc, hub);
  return () => {
    if (!hub.subs.delete(token) || hub.subs.size) return;
    hub.stop?.();
  };
}
