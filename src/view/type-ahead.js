// FIX-TYPE-1: keys typed between "new card" and the moment Roam's textarea is live.
// Roam needs the block to exist and a click on its view div before a textarea takes input. Until then focus sits
// on the board root and every key was lost (or ran a board shortcut). While armed, the board's window-capture
// keydown hands each key here first: printable text is buffered, Backspace drops the last buffered char, other
// unmodified keys are swallowed so they do not nudge, delete or retool the new card. The buffer is replayed into
// the card's textarea, in order, before the first key that reaches it directly. No writes: Roam saves the text.

const ARM_MS = 4000;

const isEditable = (node) => {
  if (!node || typeof node !== "object") return false;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  return typeof node.getAttribute === "function" && node.getAttribute("contenteditable") === "true";
};

// isTarget(node) says whether node is the new card's live editor input (a textarea inside this board's card editor).
export function createTypeAhead({ doc, isTarget, later, armMs = ARM_MS } = {}) {
  let armed = false;
  let buffer = "";
  let stopTimer = null;
  let last = null;
  const ups = new Set();
  // Chrome sends one insertText as both beforeinput and textInput on a focusable div, and only textInput on the body.
  // The second of a pair with the same text is the same insertion.
  const fresh = (kind, data) => {
    if (last && last.kind !== kind && last.data === data) { last = null; return false; }
    last = { kind, data };
    return true;
  };

  const clearTimer = () => { stopTimer?.(); stopTimer = null; };
  const cancel = () => {
    armed = false;
    buffer = "";
    last = null;
    clearTimer();
  };
  const arm = () => {
    armed = true;
    buffer = "";
    last = null;
    clearTimer();
    if (typeof later === "function") stopTimer = later(cancel, armMs);
  };

  const insert = (target, text) => {
    if (!text) return true;
    const view = doc?.defaultView || globalThis;
    if (doc?.activeElement !== target) {
      try { target.focus?.({ preventScroll: true }); } catch { /* unfocusable */ }
    }
    let done = false;
    if (doc?.activeElement === target && typeof doc.execCommand === "function") {
      try { done = doc.execCommand("insertText", false, text) === true; } catch { done = false; }
    }
    if (done) return true;
    if (typeof target.setRangeText !== "function") return false;
    const value = String(target.value ?? "");
    const start = Number.isFinite(target.selectionStart) ? target.selectionStart : value.length;
    const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
    try { target.setRangeText(text, start, end, "end"); } catch { return false; }
    const Ctor = view?.InputEvent || view?.Event || globalThis.Event;
    if (typeof Ctor === "function") {
      try { target.dispatchEvent(new Ctor("input", { bubbles: true, inputType: "insertText", data: text })); } catch { /* stub */ }
    }
    return true;
  };

  // Replays the buffer into target and disarms. Returns the text that was replayed.
  const flush = (target) => {
    if (!armed) return "";
    if (!target || !isTarget?.(target)) return "";
    const text = buffer;
    cancel();
    if (text) insert(target, text);
    return text;
  };

  // keydown, window capture. True when the key was taken (the caller returns).
  const take = (event) => {
    if (!armed || !event) return false;
    const target = event.target;
    const active = doc?.activeElement;
    const entry = isEditable(target) ? target : isEditable(active) ? active : null;
    if (entry) {
      // The card's textarea is live: put the earlier keys in first, then let this one through.
      if (isTarget?.(entry)) flush(entry);
      else cancel(); // some other input: never capture there
      return false;
    }
    if (event.isComposing) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const key = String(event.key || "");
    if (key === "Escape") { cancel(); return false; }
    if (key.length === 1) buffer += key;
    else if (key === "Backspace") buffer = buffer.slice(0, -1);
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    if (event.code || key) ups.add(event.code || key);
    return true;
  };

  // keyup, window capture. Swallows the release of a key take() kept.
  const takeUp = (event) => {
    const id = event?.code || event?.key;
    if (!id || !ups.has(id)) return false;
    ups.delete(id);
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    return true;
  };

  // beforeinput, window capture. Text inserted without a keydown (IME commit, dictation, CDP insertText).
  const takeInput = (event) => {
    if (!armed || !event) return false;
    const target = event.target;
    if (isEditable(target)) {
      if (isTarget?.(target)) flush(target);
      else cancel();
      return false;
    }
    const type = String(event.inputType || "");
    if (type === "insertText" || type === "insertReplacementText") {
      const data = String(event.data ?? "");
      if (fresh("input", data)) buffer += data;
    } else if (type === "deleteContentBackward") buffer = buffer.slice(0, -1);
    else return false;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    return true;
  };

  // textInput, window capture. The only event an insertText gets when focus fell back to the body (a menu closed).
  const takeText = (event) => {
    if (!armed || !event) return false;
    if (isEditable(event.target)) return false;
    const data = String(event.data ?? "");
    if (!data) return false;
    if (fresh("text", data)) buffer += data;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    return true;
  };

  return {
    arm,
    cancel,
    flush,
    take,
    takeUp,
    takeInput,
    takeText,
    isArmed: () => armed,
    pending: () => buffer,
  };
}
