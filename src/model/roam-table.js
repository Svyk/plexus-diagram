// A Roam {{[[table]]}} hosted inside a Plexus card. The board already uses
// src/model/table.js for its attribute table, so this file is the block table.
// Keyboard ownership is explicit: a key is yielded only while focus, a verified
// portal, or the pointer is inside a table or grid that belongs to this board.

export const TABLE_ROOT = "{{[[table]]}}";
export const TABLE_ROWS = 3;
export const TABLE_COLS = 3;
export const TABLE_SIZE = { w: 480, h: 260 };
export const TABLE_WRITES = 1 + TABLE_ROWS * (1 + TABLE_COLS);

const TABLE_RE = /^\{\{\s*(?:\[\[table\]\]|table)\s*\}\}$/i;

export function isRoamTableString(value) {
  return TABLE_RE.test(String(value ?? "").trim());
}

export function appendTable(t, { parent, plexus, order } = {}) {
  const root = t.create({
    parent,
    string: TABLE_ROOT,
    plexus,
    ...(order !== undefined ? { order } : {}),
  });
  for (let r = 0; r < TABLE_ROWS; r += 1) {
    const row = t.create({ parent: root, string: "", order: r });
    for (let c = 0; c < TABLE_COLS; c += 1) t.create({ parent: row, string: "", order: c });
  }
  return root;
}

export function planTableCreates() {
  const ops = [];
  const t = {
    create(spec) {
      const uid = `u${ops.length}`;
      ops.push({ uid, parent: spec.parent, string: spec.string, order: spec.order });
      return uid;
    },
  };
  const root = appendTable(t, { parent: "board" });
  return { root, ops, writes: ops.length, rows: TABLE_ROWS, cols: TABLE_COLS };
}

export const TABLE_HOST_SELECTOR = [
  ".pxd-roam-table",
  ".pxd-table-overlay",
  "[data-roam-grid-uid]",
  ".rg-root",
  ".rg-portal",
  "[data-rg-owner]",
  ".rg-editor",
  ".rg-lightbox",
].join(", ");

const PORTAL_SELECTOR = ".rg-portal, .rg-editor, .rg-lightbox, [data-rg-owner], .pxd-table-overlay";

export function hostOf(node) {
  return node?.closest?.(TABLE_HOST_SELECTOR) || null;
}

export function tablePointerTarget(node) {
  return hostOf(node);
}

function isFieldNode(node) {
  if (!node || node.nodeType === 9) return false;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  const ce = node.getAttribute?.("contenteditable");
  return ce === "" || ce === "true";
}

function inside(boardRoot, node) {
  if (!node) return false;
  if (!boardRoot?.contains) return true;
  return Boolean(boardRoot.contains(node));
}

function ownerUid(node) {
  const uid = String(node?.getAttribute?.("data-rg-owner") || "");
  return /^[\w-]+$/.test(uid) ? uid : "";
}

function portalForBoard(node, boardRoot) {
  const portal = node?.closest?.(PORTAL_SELECTOR);
  if (!portal) return null;
  if (inside(boardRoot, portal)) return portal;
  const uid = ownerUid(portal);
  if (!uid || typeof boardRoot?.querySelector !== "function") return null;
  const match = boardRoot.querySelector(`[data-roam-grid-uid="${uid}"], [data-pxd-table="${uid}"]`);
  return match ? portal : null;
}

export function ownershipOf({ target, active, pointerTarget, boardRoot, sourceText } = {}) {
  const focusHost = hostOf(active);
  if (focusHost && inside(boardRoot, focusHost)) {
    return { verified: true, reason: "focus", host: focusHost, sourceText };
  }
  const portal = portalForBoard(active, boardRoot) || portalForBoard(target, boardRoot);
  if (portal) return { verified: true, reason: "portal", host: portal, sourceText };
  const pointerHost = hostOf(pointerTarget || target);
  const pointerInside = Boolean(pointerHost && inside(boardRoot, pointerHost));
  const outsideField = isFieldNode(active) && !(pointerHost && pointerHost.contains?.(active));
  if (pointerInside && !outsideField) {
    return { verified: true, reason: "pointer", host: pointerHost, sourceText };
  }
  return { verified: false, sourceText };
}

export function keyGate(event, ownership) {
  const sourceText = ownership?.sourceText;
  if (!ownership?.verified) return { yield: false, sourceText };
  return {
    yield: true,
    reason: event?.key === "Escape" ? "escape" : "owned",
    sourceText,
  };
}

export function escapeKeeps(before, after) {
  return before === after;
}

export function createKeyOwner() {
  let id = null;
  let text = "";
  return {
    claim(next, sourceText) {
      id = next;
      text = sourceText ?? "";
    },
    release(next) {
      if (next !== id) return;
      id = null;
      text = "";
    },
    owns(next) {
      return id != null && id === next;
    },
    sourceText() {
      return text;
    },
  };
}
