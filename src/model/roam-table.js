// A Roam {{[[table]]}} hosted inside a Plexus card. The board already uses
// src/model/table.js for its attribute table, so this file is the block table.
// Keyboard ownership is explicit: a key is yielded only while focus, a verified
// portal, or the pointer is inside a table or grid that belongs to this board.

export const TABLE_ROOT = "{{[[table]]}}";
export const TABLE_ROWS = 3;
export const TABLE_COLS = 3;
export const TABLE_SIZE = { w: 480, h: 260 };
// Roam tables nest columns: a row block is column 1, its child column 2, and so on.
export const TABLE_WRITES = 1 + TABLE_ROWS * TABLE_COLS;
// Roam Grid column pixels. The sum of column widths stays at 1200 when it can;
// the card adds the 42px row header and 16px of padding on top of that sum.
const COL_MIN = 56;
const COL_MAX = 640;
const PX_PER_PT = 1.4;
const WIDTH_CAP = 1200;
const ROW_HEADER = 42;
const GRID_PAD = 16;
const NATIVE_PAD = 16;
const COL_HEADER = 28;
const ROW_PX = 32;
const HEIGHT_CAP = 800;
const HEIGHT_CHROME = 8;
const CHAR_PX = 7;
const CELL_PAD = 16;
const WORD_PX = 8.2;
const WORD_PAD = 24;

function clampInt(n, lo, hi) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function tableShape(table) {
  let cols = Number.isInteger(table?.cols) ? table.cols : 0;
  let rows = Number.isInteger(table?.rows) ? table.rows : 0;
  if (!rows && Array.isArray(table?.rows)) rows = table.rows.length;
  if (!cols && Array.isArray(table?.rows) && Array.isArray(table.rows[0])) cols = table.rows[0].length;
  if (Array.isArray(table?.cells)) {
    for (const cell of table.cells) {
      const r = (Number.isInteger(cell?.r) ? cell.r : 0) + (cell?.rowSpan ?? 1);
      const c = (Number.isInteger(cell?.c) ? cell.c : 0) + (cell?.colSpan ?? 1);
      if (!Number.isInteger(table?.rows)) rows = Math.max(rows, r);
      if (!Number.isInteger(table?.cols)) cols = Math.max(cols, c);
    }
  }
  return { cols: Math.max(0, cols), rows: Math.max(0, rows) };
}

function fitWidths(raw, floors) {
  const lo = raw.map((_, i) => clampInt(floors?.[i] ?? COL_MIN, COL_MIN, COL_MAX));
  let ws = raw.map((n, i) => Math.max(lo[i], clampInt(n, COL_MIN, COL_MAX)));
  const sumOf = () => ws.reduce((a, b) => a + b, 0);
  let sum = sumOf();
  if (sum > WIDTH_CAP && ws.length) {
    const scale = WIDTH_CAP / sum;
    ws = ws.map((n, i) => Math.max(lo[i], clampInt(n * scale, COL_MIN, COL_MAX)));
    sum = sumOf();
    let guard = 0;
    while (sum > WIDTH_CAP && guard < ws.length * (COL_MAX - COL_MIN + 1)) {
      guard += 1;
      let i = -1;
      for (let k = 0; k < ws.length; k += 1) if (ws[k] > lo[k] && (i < 0 || ws[k] - lo[k] > ws[i] - lo[i])) i = k;
      if (i < 0) break;
      const cut = Math.min(ws[i] - lo[i], sum - WIDTH_CAP);
      ws[i] -= cut;
      sum -= cut;
    }
  }
  const map = {};
  for (let i = 0; i < ws.length; i += 1) map[String(i)] = ws[i];
  return { map, sum };
}

function widthsFromXs(xs, cols) {
  if (!Array.isArray(xs) || xs.length < 2) return null;
  const bounds = [];
  for (const n of xs) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (bounds.length && v < bounds[bounds.length - 1]) return null;
    bounds.push(v);
  }
  const count = cols > 0 ? Math.min(cols, bounds.length - 1) : bounds.length - 1;
  if (count < 1) return null;
  const raw = [];
  for (let i = 0; i < count; i += 1) raw.push((bounds[i + 1] - bounds[i]) * PX_PER_PT);
  return raw;
}

function widthsFromText(table, cols) {
  const count = Math.max(1, cols || 1);
  const longest = Array.from({ length: count }, () => 0);
  for (const cell of table?.cells || []) {
    const c = Number.isInteger(cell?.c) ? cell.c : 0;
    if (c < 0 || c >= count) continue;
    const span = Math.max(1, Number(cell?.colSpan) || 1);
    const share = Math.ceil(String(cell?.text ?? "").length / span);
    for (let i = 0; i < span && c + i < count; i += 1) {
      longest[c + i] = Math.max(longest[c + i], share);
    }
  }
  return longest.map((n) => n * CHAR_PX + CELL_PAD);
}

// Per column: the longest single word, and the header's full text (up to 22
// characters). Words never break inside, so these are the narrowest the column
// can be without cutting a word; header words may only wrap at spaces.
function textFloors(table, cols) {
  const count = Math.max(1, cols || 1);
  const word = Array.from({ length: count }, () => 0);
  const head = Array.from({ length: count }, () => 0);
  const headerRows = Number.isInteger(table?.headerRows) ? table.headerRows : 0;
  for (const cell of table?.cells || []) {
    const c = Number.isInteger(cell?.c) ? cell.c : 0;
    if (c < 0 || c >= count) continue;
    const span = Math.max(1, Number(cell?.colSpan) || 1);
    const text = String(cell?.text ?? "").trim();
    const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
    const isHead = cell?.header === true || (Number.isInteger(cell?.r) && cell.r < headerRows);
    for (let i = 0; i < span && c + i < count; i += 1) {
      word[c + i] = Math.max(word[c + i], Math.ceil(longest / span));
      if (isHead && span === 1) head[c + i] = Math.max(head[c + i], Math.min(22, text.length));
    }
  }
  return word.map((n, i) => ({ word: n, head: head[i] }));
}

function cardHeight(rows) {
  return Math.min(HEIGHT_CAP, COL_HEADER + Math.max(1, rows || 1) * ROW_PX + HEIGHT_CHROME);
}

const TABLE_RE = /^\{\{\s*(?:\[\[table\]\]|table)\s*\}\}$/i;

export function isRoamTableString(value) {
  return TABLE_RE.test(String(value ?? "").trim());
}

// widths is null unless grid.xs gives column boundaries. Each width is in [56, 640].
// The sum is at most 1200 unless every column is already at the 56px floor.
// Card width adds grid chrome (row header + padding) and stays at 1200 when the
// columns themselves already exceed that. Height is the column header plus rows, capped at 800.
export function parsedTableSize(table) {
  const shape = tableShape(table);
  const rawGrid = widthsFromXs(table?.grid?.xs ?? table?.xs, shape.cols);
  const raw = rawGrid || widthsFromText(table, shape.cols);
  const est = textFloors(table, raw.length);
  const floors = est.map((e) => (e.word ? e.word * WORD_PX + WORD_PAD : 0));
  const wanted = raw.map((n, i) => Math.max(n, floors[i], est[i].head ? est[i].head * WORD_PX + WORD_PAD : 0));
  const fitted = fitWidths(wanted, floors);
  const fromGrid = rawGrid ? fitted : null;
  const chrome = fromGrid ? ROW_HEADER + GRID_PAD : NATIVE_PAD;
  const w = fitted.sum > WIDTH_CAP ? WIDTH_CAP : Math.min(WIDTH_CAP + chrome, fitted.sum + chrome);
  return {
    w,
    h: cardHeight(shape.rows),
    widths: fromGrid ? fromGrid.map : null,
  };
}

export function appendTable(t, { parent, plexus, order } = {}) {
  const root = t.create({
    parent,
    string: TABLE_ROOT,
    plexus,
    ...(order !== undefined ? { order } : {}),
  });
  for (let r = 0; r < TABLE_ROWS; r += 1) {
    let cell = t.create({ parent: root, string: "", order: r });
    for (let c = 1; c < TABLE_COLS; c += 1) cell = t.create({ parent: cell, string: "", order: 0 });
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
