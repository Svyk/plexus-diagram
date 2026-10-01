// Keys while a card's Roam editor is focused.
// Enter on the root block would insert a sibling, and that sibling is a new board item.
// It has to become a child of the card instead. Tab, Shift+Tab, and Cmd+Enter stay with Roam.

const UID = /^[A-Za-z0-9_-]{9,15}$/;

export function blockUidFromNode(node) {
  let el = node;
  while (el && el.nodeType === 1) {
    const id = String(el.id || el.getAttribute?.("id") || "");
    if (id.startsWith("block-input-")) {
      const rest = id.slice("block-input-".length);
      if (UID.test(rest)) return rest;
    }
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
} = {}) {
  if (autocomplete) return { type: "roam" };
  const mod = Boolean(meta || ctrl);
  if (key === "Tab" && !alt) return { type: "roam" };
  if (key === "Enter" && mod && !shift && !alt) return { type: "roam" };
  // Enter stays with Roam. Inside this embed, Roam inserts the new block as a
  // child of the card (not a board sibling) and repaints the outline. Writing
  // the child through the API leaves a block the open editor never shows.
  if (key === "Backspace" && isRoot && fresh && !mod && !alt) {
    const text = String(value ?? "");
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    if (!text.trim() && start === end) return { type: "delete-card" };
  }
  return { type: "roam" };
}
