// Keys while a card's Roam editor is focused.
// A native Roam diagram node is one block: Enter adds a line to it. That is the
// default here too. The "child" setting hands Enter to Roam, which makes a child
// of the card inside this embed. Tab, Shift+Tab, and Cmd+Enter stay with Roam.

const UID = /^[A-Za-z0-9_-]{9,15}$/;

// Embed textareas are `block-input-render-block-path-<card>-uuid…-<block>`.
// The block is the shortest 9–15 char suffix after a hyphen: a uuid piece is
// 12 hex chars, and a longer match would swallow it. Uids may contain "-" and "_".
function uidFromBlockInput(id) {
  const prefix = "block-input-";
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (UID.test(rest)) return rest;
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    if (rest[i] !== "-") continue;
    const tail = rest.slice(i + 1);
    if (tail.length > 15) return null;
    if (UID.test(tail)) return tail;
  }
  return null;
}

export function blockUidFromNode(node) {
  let el = node;
  while (el && el.nodeType === 1) {
    const id = String(el.id || el.getAttribute?.("id") || "");
    const fromInput = uidFromBlockInput(id);
    if (fromInput) return fromInput;
    if (UID.test(id)) return id;
    const data = el.dataset?.uid || el.getAttribute?.("data-uid") || "";
    if (UID.test(data)) return data;
    el = el.parentElement;
  }
  return null;
}

// A nested block lives in `.rm-block-children` inside the card editor.
// The page's own children wrapper is an ancestor of the whole board, so it does not count.
const inside = (node, ancestor) => {
  let el = node;
  while (el && el.nodeType === 1) {
    if (el === ancestor) return true;
    el = el.parentElement;
  }
  return false;
};

export function inputBlockRole(node, rootUid) {
  const uid = blockUidFromNode(node);
  const editor = node?.closest?.(".pxd-item__editor") || null;
  const nest = node?.closest?.(".rm-block-children") || null;
  if (nest && inside(nest, editor)) return { role: "child", uid };
  if (uid && rootUid && uid !== rootUid) return { role: "child", uid };
  return { role: "root", uid: uid || rootUid || null };
}

export function editorKeyAction({
  key,
  shift = false,
  meta = false,
  ctrl = false,
  alt = false,
  autocomplete = false,
  isRoot = false,
  fresh = false,
  value = "",
  selectionStart = 0,
  selectionEnd = 0,
  enterMode = "newline",
} = {}) {
  if (autocomplete) return { type: "roam" };
  const mod = Boolean(meta || ctrl);
  if (key === "Tab" && !alt) return { type: "roam" };
  if (key === "Enter" && mod && !shift && !alt) return { type: "roam" };
  // Shift+Enter on the card's top block makes a child. Inside a nested block it stays
  // Roam's soft newline. Autocomplete and a modifier chord stay with Roam too.
  if (key === "Enter" && shift && !mod && !alt && isRoot) return { type: "make-child" };
  // In "child" mode Enter stays with Roam, which inserts the new block as a child
  // of the card and repaints the outline. Writing the child through the API
  // leaves a block the open editor never shows.
  if (key === "Enter" && isRoot && !shift && !mod && !alt && enterMode !== "child") return { type: "newline" };
  if (key === "Backspace" && isRoot && fresh && !mod && !alt) {
    const text = String(value ?? "");
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    if (!text.trim() && start === end) return { type: "delete-card" };
  }
  return { type: "roam" };
}
