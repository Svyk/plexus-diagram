// Clipboard wiring: capture-phase copy / cut / paste on the document, acting only while the board owns the
// keyboard and no text field is involved. Planning lives in model/clipboard.js; the view executes it.

import { PLEXUS_MIME, parseClipboard } from "../model/clipboard.js";

const CLONE_WINDOW_MS = 400;
const MAX_IMAGES = 10;

const defaultTextEntry = (node) => {
  if (!node || node.nodeType !== 1) return false;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return node.isContentEditable === true || node.getAttribute?.("contenteditable") === "true" || node.getAttribute?.("contenteditable") === "";
};

export function filesFromDataTransfer(dt) {
  const out = [];
  const seen = new Set();
  const add = (f) => {
    if (!f || typeof f.type !== "string" || !f.type.startsWith("image/") || seen.has(f) || out.length >= MAX_IMAGES) return;
    seen.add(f);
    out.push(f);
  };
  for (const f of dt?.files ?? []) add(f);
  // Chromium lists a pasted image in both files and items, and getAsFile returns a new
  // File each time, so identity cannot dedupe them. One paste uploaded the image twice.
  if (out.length) return out;
  for (const item of dt?.items ?? []) {
    if (item?.kind === "file") { try { add(item.getAsFile?.()); } catch { /* ignore */ } }
  }
  return out;
}

// During dragenter/dragover the browser hides file contents (files is empty, getAsFile is
// null) but still exposes each item's kind and type, so acceptance must be decided from those.
export function dragHasImages(dt) {
  if (filesFromDataTransfer(dt).length) return true;
  for (const item of dt?.items ?? []) {
    if (item?.kind === "file" && String(item.type || "").startsWith("image/")) return true;
  }
  return false;
}

// Chromium's async clipboard rejects custom types such as application/x-plexus-card+json. A copy event can carry
// them. parts: { mime: string }. Returns true only when the copy ran and the handler set the data.
export const ASYNC_CLIPBOARD_TYPES = new Set(["text/plain", "text/html", "image/png"]);

export function copyViaEvent(doc, parts) {
  if (!doc || typeof doc.execCommand !== "function" || typeof doc.addEventListener !== "function") return false;
  const entries = Object.entries(parts || {}).filter(([, v]) => typeof v === "string");
  if (!entries.length) return false;
  let set = false;
  const onCopy = (event) => {
    const data = event.clipboardData;
    if (!data?.setData) return;
    for (const [type, value] of entries) {
      try { data.setData(type, value); set = true; } catch { /* type refused */ }
    }
    if (set) {
      event.preventDefault?.();
      // A board's own copy handler would add its selected cards to the same clipboard.
      event.stopImmediatePropagation?.();
    }
  };
  const target = typeof doc.defaultView?.addEventListener === "function" ? doc.defaultView : doc;
  target.addEventListener("copy", onCopy, true);
  let ran = false;
  try { ran = Boolean(doc.execCommand("copy")); } catch { ran = false; }
  target.removeEventListener("copy", onCopy, true);
  return ran && set;
}

export async function writeClipboard({ text = "", mime = null, data = null } = {}) {
  const nav = globalThis.navigator;
  try {
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(String(text)); return true; }
  } catch { /* fall back */ }
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = String(text);
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.append(area);
  const onCopy = (event) => {
    if (mime && data != null) { try { event.clipboardData?.setData(mime, typeof data === "string" ? data : JSON.stringify(data)); } catch { /* ignore */ } }
  };
  doc.addEventListener("copy", onCopy, true);
  let ok = false;
  try {
    area.focus?.();
    area.select?.();
    ok = Boolean(doc.execCommand?.("copy"));
  } catch { ok = false; }
  doc.removeEventListener("copy", onCopy, true);
  area.remove();
  return ok;
}

export function createClipboardIO({ doc = globalThis.document, root, ownsKeyboard, isTextEntry, on = {}, now = () => Date.now() } = {}) {
  const offs = [];
  const win = doc.defaultView ?? globalThis.window;
  let lastCloneKey = -Infinity;

  const listen = (target, type, fn, opts) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  const textNode = (node) => Boolean(isTextEntry?.(node)) || defaultTextEntry(node);
  const inText = (event) => textNode(event.target) || textNode(doc.activeElement);
  const editorNode = (event) => {
    const node = event.target?.nodeType === 1 ? event.target : null;
    const hit = textNode(node) ? node : (textNode(doc.activeElement) ? doc.activeElement : null);
    if (!hit || typeof hit.closest !== "function") return null;
    const editor = hit.closest(".pxd-item__editor");
    if (!editor) return null;
    if (root && typeof root.contains === "function" && !root.contains(editor)) return null;
    return hit;
  };
  const active = (event) => Boolean(ownsKeyboard?.()) && !inText(event);

  const copy = (event, cut = false) => {
    const payload = on.getPayload?.({ cut });
    if (!payload || !event.clipboardData) return false;
    event.clipboardData.setData(PLEXUS_MIME, payload.mime);
    event.clipboardData.setData("text/plain", payload.text);
    event.preventDefault();
    return true;
  };

  listen(doc, "copy", (event) => { if (active(event)) copy(event); }, true);
  listen(doc, "cut", (event) => { if (active(event) && copy(event, true)) on.cutDone?.(); }, true);
  listen(win, "keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && String(event.key).toLowerCase() === "v") lastCloneKey = now();
  }, true);
  // Window capture runs before Roam's document paste handler. stopPropagation here
  // keeps a card-root paste from becoming board siblings.
  listen(win, "paste", (event) => {
    if (!editorNode(event)) return;
    if (on.editorPaste?.(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  listen(doc, "paste", (event) => {
    if (editorNode(event)) return;
    if (!active(event)) return;
    const parsed = parseClipboard(event.clipboardData);
    if (!parsed) return;
    event.preventDefault();
    if (parsed.kind === "plexus") on.pastePlexus?.(parsed.data, { clone: now() - lastCloneKey <= CLONE_WINDOW_MS });
    else if (parsed.kind === "card-json") on.pasteCardJson?.(parsed.data);
    else if (parsed.kind === "images") on.pasteImages?.(parsed.files);
    else on.pasteText?.(parsed.entries);
  }, true);

  return { dispose() { offs.splice(0).forEach((off) => off()); } };
}
