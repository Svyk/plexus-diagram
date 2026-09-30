// Pure clipboard planning: what a copy puts on the clipboard and how a paste or a subtree clone is turned
// into Roam creates. No DOM, no Roam calls; the host executes the returned plans.
import { boundsOf, topLevelOf } from "./board.js";
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
    } catch { /* fall through to images and text */ }
  }
  const files = [...(data?.files ?? [])].filter((f) => typeof f?.type === "string" && f.type.startsWith("image/"));
  if (files.length) return { kind: "images", files };
  const entries = parsePastedText(get("text/plain"));
  return entries.length ? { kind: "text", entries } : null;
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
      string: edgeString({ srcRef: refOfNew(from), dstRef: refOfNew(to), dir: edge.dir, label: edge.label }),
      props: { [PLEXUS_KEY]: serializeEdge({ ...edge, from, to }) },
      open: true,
    });
  }
  return creates;
}
