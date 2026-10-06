// Trails (MEM-6). A trail is a block under the board's collapsed Trails child.
// Stops are ((uid)) children in block order. A stop's note is its first child.
// Nothing here writes.

const TRAIL_RE = /^\{\{\[\[plexus-trail\]\]\}\}\s*([\s\S]*)$/;
const STOP_RE = /^\(\(([\w-]+)\)\)$/;

function sortedChildren(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function plexusType(node) {
  const props = node?.[":block/props"];
  if (!props || typeof props !== "object") return undefined;
  const plexus = props.plexus ?? props[":plexus"];
  return plexus && typeof plexus === "object" ? plexus.type : undefined;
}

export function trailString(name) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  return `{{[[plexus-trail]]}} ${n || "Trail"}`;
}

export function parseTrailName(string) {
  const m = TRAIL_RE.exec(String(string ?? "").trim());
  return m ? m[1].trim() : "";
}

export function parseStopRef(string) {
  const m = STOP_RE.exec(String(string ?? "").trim());
  return m ? m[1] : "";
}

// A trail block, or null. type "trail" or the macro string is enough.
export function parseTrailBlock(node) {
  if (!node || typeof node !== "object") return null;
  const string = node[":block/string"] ?? node.string ?? "";
  const macro = TRAIL_RE.test(String(string).trim());
  if (plexusType(node) !== "trail" && !macro) return null;
  const stops = [];
  for (const child of sortedChildren(node)) {
    const ref = parseStopRef(child[":block/string"] ?? child.string ?? "");
    if (!ref) continue;
    const noteNode = sortedChildren(child)[0];
    stops.push({
      uid: child[":block/uid"] || child.uid,
      ref,
      note: noteNode ? String(noteNode[":block/string"] ?? noteNode.string ?? "") : "",
      noteUid: noteNode?.[":block/uid"] || noteNode?.uid || "",
    });
  }
  return {
    uid: node[":block/uid"] || node.uid,
    name: parseTrailName(string) || "Trail",
    stops,
  };
}

export function parseTrails(containerNode) {
  if (!containerNode) return [];
  const out = [];
  for (const child of sortedChildren(containerNode)) {
    const trail = parseTrailBlock(child);
    if (trail) out.push(trail);
  }
  return out;
}

// Up to `limit` stop titles, in order. titleOf(ref) may be absent.
export function trailStrip(stops, titleOf, limit = 8) {
  const list = Array.isArray(stops) ? stops : [];
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : 8;
  const out = [];
  for (const stop of list) {
    if (out.length >= cap) break;
    const uid = stop?.ref || stop?.uid || "";
    if (!uid) continue;
    let title = "";
    if (typeof titleOf === "function") {
      try { title = titleOf(uid) || ""; } catch { title = ""; }
    }
    if (!title) title = stop?.title || uid;
    out.push({ uid, title: String(title), index: out.length + 1 });
  }
  return out;
}

// Card ref → 1-based badge. The first stop that names a card wins.
export function trailBadges(trail) {
  const map = new Map();
  let n = 0;
  for (const stop of trail?.stops || []) {
    n += 1;
    const ref = stop?.ref;
    if (!ref || map.has(ref)) continue;
    map.set(ref, n);
  }
  return map;
}

// Centers of stops that have a rect. Off-board stops are skipped.
export function trailPoints(stops, rects) {
  const out = [];
  for (const stop of stops || []) {
    const r = rects?.get?.(stop?.ref);
    if (!r) continue;
    out.push({ uid: stop.ref, x: r.x + r.w / 2, y: r.y + r.h / 2 });
  }
  return out;
}

// Horizontal strip of stop titles and a Walk button. Listeners live on the strip, not the document.
export function renderTrailStrip(doc, parent, stops, { onStop, onWalk } = {}) {
  if (!parent) return parent;
  parent.replaceChildren?.();
  parent.className = "pxd-trail-strip";
  const list = Array.isArray(stops) ? stops : [];
  list.forEach((stop, i) => {
    if (i) {
      const arrow = doc.createElement("span");
      arrow.className = "pxd-trail-strip__arrow";
      arrow.textContent = "→";
      parent.append(arrow);
    }
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "pxd-trail-strip__stop";
    if (stop?.uid) btn.dataset.uid = stop.uid;
    btn.textContent = stop?.title || "";
    btn.setAttribute("aria-label", stop?.title || "Trail stop");
    btn.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      onStop?.(stop);
    });
    parent.append(btn);
  });
  const walk = doc.createElement("button");
  walk.type = "button";
  walk.className = "pxd-trail-strip__walk";
  walk.textContent = "Walk";
  walk.setAttribute("aria-label", "Walk trail");
  walk.addEventListener("click", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    onWalk?.();
  });
  parent.append(walk);
  // POL-4. Roam cancels Enter before a button's own activation inside a block, so the strip handles it.
  parent.__pxdStrip = { list, onStop, onWalk };
  if (!parent.__pxdStripKeys) {
    parent.__pxdStripKeys = true;
    parent.addEventListener("keydown", (event) => {
      const now = parent.__pxdStrip || {};
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (target?.closest?.(".pxd-trail-strip__walk")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        now.onWalk?.();
        return;
      }
      const btn = target?.closest?.(".pxd-trail-strip__stop");
      if (!btn) return;
      const i = [...parent.querySelectorAll(".pxd-trail-strip__stop")].indexOf(btn);
      if (i < 0) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      now.onStop?.(now.list?.[i]);
    });
  }
  return parent;
}
