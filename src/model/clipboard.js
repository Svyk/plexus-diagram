// Pure clipboard planning: what a copy puts on the clipboard and how a paste or a subtree clone is turned
// into Roam creates. No DOM, no Roam calls; the host executes the returned plans.
import { boundsOf, topLevelOf } from "./board.js";
import { CARD_JSON_MIME, parseCardJson } from "./pdf-pin.js";
import { PLEXUS_KEY, edgeString, plainKeys, semanticRef, serializeEdge } from "./schema.js";

export const PLEXUS_MIME = "application/x-plexus-cards";

const MAX_PASTED_LINES = 50;

export function copyPayload(board, uids, rects) {
  const top = topLevelOf(board, [...uids]);
  const items = [];
  const boxes = [];
  for (const uid of top) {
    const item = board.items.get(uid);
    const r = rects.get(uid);
    if (!item || !r) continue;
    boxes.push(r);
    items.push({
      uid,
      type: item.type,
      kind: item.kind,
      string: item.string,
      target: item.target,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      color: item.color,
    });
  }
  const bounds = boundsOf(boxes);
  return {
    mime: JSON.stringify({ v: 1, board: board.uid, bounds, items }),
    text: items.map((i) => semanticRef(i)).join("\n"),
  };
}

export function parsePastedText(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "").trim();
    if (!line) continue;
    out.push({ string: line });
    if (out.length >= MAX_PASTED_LINES) break;
  }
  return out;
}

export function parseClipboard(data) {
  const get = (type) => {
    try { return data?.getData?.(type) ?? ""; } catch { return ""; }
  };
  const raw = get(PLEXUS_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && Array.isArray(parsed.items)) return { kind: "plexus", data: parsed };
    } catch { /* fall through to the card payload, images, and text */ }
  }
  const card = parseCardJson(get(CARD_JSON_MIME));
  if (card) return { kind: "card-json", data: card };
  const files = [...(data?.files ?? [])].filter((f) => typeof f?.type === "string" && f.type.startsWith("image/"));
  if (files.length) return { kind: "images", files };
  const entries = parsePastedText(get("text/plain"));
  return entries.length ? { kind: "text", entries } : null;
}

// Paste inside a card editor. A sibling of the card root is a new board item, so extra
// lines become children of that block. One line stays with Roam (caret insert). Images
// are uploaded by the view and inlined into the focused block. 1 update + 44 children
// stays inside the 45-write undo cap.
const MAX_EDITOR_LINES = 45;

export function editorPastePlan({
  text = "",
  imageCount = 0,
  value = "",
  selectionStart = 0,
  selectionEnd = 0,
  isRoot = false,
} = {}) {
  if ((Number(imageCount) || 0) > 0) return { type: "images" };
  if (!isRoot) return { type: "roam" };
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw.includes("\n")) return { type: "roam" };
  let lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= 1) return { type: "roam" };
  if (lines.length > MAX_EDITOR_LINES) lines = lines.slice(0, MAX_EDITOR_LINES);
  const v = String(value ?? "");
  let a = Number(selectionStart);
  let b = Number(selectionEnd);
  if (!Number.isFinite(a)) a = v.length;
  if (!Number.isFinite(b)) b = a;
  const start = Math.max(0, Math.min(Math.min(a, b), v.length));
  const end = Math.max(start, Math.min(Math.max(a, b), v.length));
  return {
    type: "blocks",
    string: v.slice(0, start) + lines[0] + v.slice(end),
    children: lines.slice(1),
  };
}

export function inlineAtCaret(value, selectionStart, selectionEnd, insert) {
  const v = String(value ?? "");
  const chunk = String(insert ?? "");
  let a = Number(selectionStart);
  let b = Number(selectionEnd);
  if (!Number.isFinite(a)) a = v.length;
  if (!Number.isFinite(b)) b = a;
  const start = Math.max(0, Math.min(Math.min(a, b), v.length));
  const end = Math.max(start, Math.min(Math.max(a, b), v.length));
  return { string: v.slice(0, start) + chunk + v.slice(end), caret: start + chunk.length };
}

export function imageMarkdown(urls) {
  return [...(urls ?? [])].filter((u) => typeof u === "string" && u).map((u) => `![](${u})`).join("");
}

export function refCardStrings(data, at) {
  const items = data?.items ?? [];
  if (!items.length) return [];
  const bounds = data.bounds ?? boundsOf(items) ?? { x: 0, y: 0 };
  return items.map((i) => ({
    string: semanticRef(i),
    x: at.x + (i.x - bounds.x),
    y: at.y + (i.y - bounds.y),
    w: i.w,
    h: i.h,
    color: i.color,
  }));
}

const REF = /\(\(([\w-]+)\)\)/g;
const rewriteRefs = (string, uidMap) => String(string ?? "").replace(REF, (m, uid) => (uidMap.has(uid) ? `((${uidMap.get(uid)}))` : m));

function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

export function planSubtreeClone(node, { genUid, parentUid, order = "last", plexusPatch = null, uidMap = new Map() } = {}) {
  const assign = (n) => {
    uidMap.set(n[":block/uid"], genUid());
    for (const c of sortedKids(n)) assign(c);
  };
  assign(node);
  const creates = [];
  const emit = (n, parent, ord, isRoot) => {
    const props = n[":block/props"] == null ? null : plainKeys(n[":block/props"]);
    let outProps = props;
    if (isRoot && plexusPatch) {
      outProps = { ...(props ?? {}) };
      outProps[PLEXUS_KEY] = { ...(outProps[PLEXUS_KEY] ?? {}), ...plexusPatch };
    }
    const uid = uidMap.get(n[":block/uid"]);
    creates.push({
      uid,
      parent,
      order: ord,
      string: rewriteRefs(n[":block/string"], uidMap),
      props: outProps,
      open: n[":block/open"] !== false,
    });
    sortedKids(n).forEach((c, i) => emit(c, uid, i, false));
  };
  emit(node, parentUid, order, true);
  return { creates, uidMap };
}

export function planEdgeClones(edges, uidMap, { genUid, containerUid, refOfNew } = {}) {
  const list = edges instanceof Map ? [...edges.values()] : [...(edges ?? [])];
  const creates = [];
  for (const edge of list) {
    if (!uidMap.has(edge.from) || !uidMap.has(edge.to)) continue;
    const from = uidMap.get(edge.from);
    const to = uidMap.get(edge.to);
    creates.push({
      uid: genUid(),
      parent: containerUid,
      order: "last",
      string: edgeString({ srcRef: refOfNew(from), dstRef: refOfNew(to), dir: edge.dir, label: edge.label, srcBlock: edge.fromBlock, dstBlock: edge.toBlock }),
      props: { [PLEXUS_KEY]: serializeEdge({ ...edge, from, to }) },
      open: true,
    });
  }
  return creates;
}
