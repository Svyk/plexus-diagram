// PDF highlight drag. Reads a React fiber for the block uid. No writes.

export const PDF_MARK = ".TextHighlight__part, .AreaHighlight__part, .AreaHighlight";

const UID = /^[A-Za-z0-9_-]{9}$/;
const FIBER_LIMIT = 10;
const CHIP_LEN = 60;

export function fiberOf(node) {
  if (!node || typeof node !== "object") return null;
  let keys = [];
  try { keys = Object.keys(node); } catch { return null; }
  for (const key of keys) {
    if (!key.startsWith("__reactFiber")) continue;
    const fiber = node[key];
    if (fiber && typeof fiber === "object") return fiber;
  }
  return null;
}

export function highlightFromFiber(fiber) {
  let current = fiber;
  for (let depth = 0; depth < FIBER_LIMIT && current; depth += 1) {
    const highlight = current.memoizedProps?.value?.highlight;
    if (highlight && typeof highlight === "object") return highlight;
    current = current.return;
  }
  return null;
}

function acceptId(id, exists) {
  if (typeof id !== "string" || !UID.test(id)) return null;
  if (typeof exists !== "function") return id;
  try {
    if (exists(id) !== true) return null;
  } catch {
    return null;
  }
  return id;
}

export function uidFromFiber(fiber, exists) {
  const highlight = highlightFromFiber(fiber);
  if (!highlight) return null;
  return acceptId(highlight.id, exists);
}

function highlightOf(node) {
  if (!node || typeof node !== "object") return null;
  const direct = highlightFromFiber(fiberOf(node));
  if (direct) return direct;
  const container = typeof node.closest === "function" ? node.closest(".rm-pdf-highlight-container") : null;
  if (!container || container === node) return null;
  return highlightFromFiber(fiberOf(container));
}

export function uidFromMark(node, exists) {
  const highlight = highlightOf(node);
  if (!highlight) return null;
  const uid = acceptId(highlight.id, exists);
  if (!uid) return null;
  return { uid, highlight };
}

export function dragChipText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, CHIP_LEN);
}
