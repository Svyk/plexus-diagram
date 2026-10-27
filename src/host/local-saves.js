// PXD-9 F10: "this window just saved a block edit", so a followed query or linked references can read again without a
// pull per transaction (a reverse-ref watch on a page with 2,500 backlinks costs about 8 ms on every one). Every
// listener in a document shares one set of signals:
// - Typing in a block editor (`input`): heard at once, and again SAVE_LAG_MS after the last key. Roam writes typed
//   text about 0.7 s after a key, one write for every key before it, so a read at the first key can miss the last.
// - Leaving a block editor (`focusout`), a checkbox (`change`), a drop.
// - Roam's sync dot (`.rm-sync__icon`) changing class: writes that are not typing (a menu, an undo, an extension).
//   While Roam's sync is backed up the dot stays on saving and says little; the tray's poll is the backstop.
// Before the topbar is drawn there is no dot: the next listener looks again.
// PXD-20: the same listeners also say whether the user is editing (watchEditing, editState), so a slow read can wait.
// Typing: an editor key in the last EDIT_IDLE_MS while a block editor has focus. Busy: any save signal but the lag
// one in the last BUSY_IDLE_MS (longer: writes every 2 s, from a menu or another extension, are edits that go on).
// Leaving an editor with no editor focused BLUR_IDLE_MS later ends both at once (Enter moves the caret to a new block
// through a blur, and that is still typing).
export const SAVE_LAG_MS = 1000;
export const EDIT_IDLE_MS = 2000;
export const BUSY_IDLE_MS = 5000;
export const BLUR_IDLE_MS = 400;
const ICON = ".rm-sync__icon";
const SAVING = /saving/;
const hubs = new WeakMap();

const isEditor = (node) => node?.tagName === "TEXTAREA" && Boolean(node.classList?.contains?.("rm-block-input"));
const inBlock = (node) => Boolean(node?.closest?.(".roam-block, .rm-block"));

function call(set, why) {
  for (const cb of [...set]) {
    try { cb(why); } catch { /* one listener cannot stop the rest */ }
  }
}

// Edit state is kept only while someone watches it: a board that follows a block source adds no timers per key.
function clearEdit(hub, win) {
  for (const k of ["keys", "quiet", "blur"]) {
    if (hub[k]) win.clearTimeout(hub[k]);
    hub[k] = null;
  }
}

function settle(hub, win) {
  const why = hub.keys ? "typing" : hub.quiet ? "busy" : "";
  clearEdit(hub, win);
  if (why) call(hub.edits, why);
}

function arm(hub, win, k, ms) {
  if (!hub.edits.size) return;
  if (hub[k]) win.clearTimeout(hub[k]);
  hub[k] = win.setTimeout(() => { hub[k] = null; call(hub.edits, k === "keys" ? "typing" : "busy"); }, ms);
}

function fire(hub, win, lag = false) {
  if (!lag) arm(hub, win, "quiet", BUSY_IDLE_MS);
  call(hub.subs);
}

function watchDot(doc, hub) {
  if (hub.mo && hub.box?.isConnected !== false) return;
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
      if (hit) fire(hub, hub.win);
    });
    mo.observe(box, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
    hub.mo = mo;
    hub.box = box;
  } catch {
    hub.mo = null;
  }
}

function start(doc, hub) {
  const win = doc.defaultView || globalThis;
  hub.win = win;
  hub.onInput = (event) => {
    if (!isEditor(event?.target)) return;
    if (hub.blur) win.clearTimeout(hub.blur);
    hub.blur = null;
    arm(hub, win, "keys", EDIT_IDLE_MS);
    fire(hub, win);
    if (hub.lag) win.clearTimeout(hub.lag);
    hub.lag = win.setTimeout(() => { hub.lag = null; fire(hub, win, true); }, SAVE_LAG_MS);
  };
  hub.onDone = (event) => {
    if (event?.type === "focusout" && !isEditor(event.target)) return;
    if (event?.type === "change" && !inBlock(event.target)) return;
    fire(hub, win);
    if (event?.type !== "focusout" || !hub.edits.size) return;
    if (hub.blur) win.clearTimeout(hub.blur);
    hub.blur = win.setTimeout(() => {
      hub.blur = null;
      if (!isEditor(doc.activeElement)) settle(hub, win);
    }, BLUR_IDLE_MS);
  };
  hub.stop = () => {
    doc.removeEventListener?.("input", hub.onInput, true);
    for (const type of ["focusout", "change", "drop"]) doc.removeEventListener?.(type, hub.onDone, true);
    if (hub.lag) win.clearTimeout(hub.lag);
    hub.lag = null;
    try { hub.mo?.disconnect?.(); } catch { /* gone */ }
    hub.mo = null;
    hub.box = null;
    hub.stop = null;
  };
  doc.addEventListener?.("input", hub.onInput, true);
  for (const type of ["focusout", "change", "drop"]) doc.addEventListener?.(type, hub.onDone, true);
}

function hubOf(doc) {
  let hub = hubs.get(doc);
  if (!hub) {
    hub = { subs: new Set(), edits: new Set(), mo: null, box: null, lag: null, keys: null, quiet: null, blur: null, stop: null };
    hubs.set(doc, hub);
  }
  if (!hub.stop) start(doc, hub);
  return hub;
}

function release(hub, set, token) {
  if (!set.delete(token)) return;
  if (!hub.edits.size && hub.win) clearEdit(hub, hub.win);
  if (hub.subs.size || hub.edits.size) {
    if (!hub.subs.size) {
      try { hub.mo?.disconnect?.(); } catch { /* gone */ }
      hub.mo = null;
      hub.box = null;
    }
    return;
  }
  hub.stop?.();
}

export function watchLocalSaves(doc, cb) {
  if (!doc || typeof cb !== "function") return () => {};
  const hub = hubOf(doc);
  const token = () => cb();
  hub.subs.add(token);
  watchDot(doc, hub);
  return () => release(hub, hub.subs, token);
}

// cb(why) runs when the edit state may have gone idle: "typing" when the user's keys stopped or they left the editors,
// "busy" when the save signals stopped.
// The document listeners only, not the sync dot: a block source has no other use for it.
export function watchEditing(doc, cb) {
  if (!doc || typeof cb !== "function") return () => {};
  const hub = hubOf(doc);
  const token = (why) => cb(why);
  hub.edits.add(token);
  return () => release(hub, hub.edits, token);
}

export function editState(doc) {
  const hub = doc ? hubs.get(doc) : null;
  if (!hub?.edits.size) return { typing: false, busy: false };
  let focused = false;
  try { focused = isEditor(doc.activeElement); } catch { focused = false; }
  return { typing: Boolean(hub.keys) && focused, busy: Boolean(hub.keys || hub.quiet) };
}
