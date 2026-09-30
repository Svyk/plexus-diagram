// Pure layout helpers: tidy rows/columns/grids, overlap spacing, same-size, mind-map trees.
// Everything works in world units and returns plain positions; nothing here touches the DOM or Roam.

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const norm = (n) => n + 0;

function unionOf(list) {
  let x0 = Infinity;
  let y0 = Infinity;
  for (const r of list) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); }
  return { x: x0, y: y0 };
}

function gridPlace(items, origin, gap, columns) {
  const n = items.length;
  const cols = Math.max(1, Math.min(n, Math.floor(num(columns, 0)) || Math.ceil(Math.sqrt(n))));
  const colW = new Array(cols).fill(0);
  const rowH = [];
  items.forEach((r, i) => {
    const c = i % cols;
    const row = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], r.w);
    rowH[row] = Math.max(rowH[row] ?? 0, r.h);
  });
  const colX = [];
  let x = origin.x;
  for (let c = 0; c < cols; c++) { colX[c] = x; x += colW[c] + gap; }
  const rowY = [];
  let y = origin.y;
  for (let row = 0; row < rowH.length; row++) { rowY[row] = y; y += rowH[row] + gap; }
  return items.map((r, i) => ({ uid: r.uid, x: norm(colX[i % cols]), y: norm(rowY[Math.floor(i / cols)]) }));
}

export function tidyRects(list, mode, { gap = 24, columns = null, order = null } = {}) {
  const rects = (list ?? []).map((r, i) => ({ ...r, i }));
  if (!rects.length) return [];
  const origin = unionOf(rects);
  if (mode === "row") {
    const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y || a.i - b.i);
    let x = origin.x;
    return sorted.map((r) => {
      const out = { uid: r.uid, x: norm(x), y: norm(origin.y) };
      x += r.w + gap;
      return out;
    });
  }
  if (mode === "column") {
    const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);
    let y = origin.y;
    return sorted.map((r) => {
      const out = { uid: r.uid, x: norm(origin.x), y: norm(y) };
      y += r.h + gap;
      return out;
    });
  }
  const reading = [...rects].sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);
  if (mode === "outline") {
    const byUid = new Map(rects.map((r) => [r.uid, r]));
    const seen = new Set();
    const ordered = [];
    for (const uid of order ?? []) {
      const r = byUid.get(uid);
      if (r && !seen.has(uid)) { seen.add(uid); ordered.push(r); }
    }
    for (const r of reading) if (!seen.has(r.uid)) ordered.push(r);
    return gridPlace(ordered, origin, gap, columns);
  }
  return gridPlace(reading, origin, gap, columns);
}

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const overlapY = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

// `movedUids` push the others away. `fixed` uids (pinned cards) are never displaced but do not push either.
export function spaceOut(rects, movedUids, { gap = 16, maxPasses = 8, fixed = null } = {}) {
  const moved = movedUids instanceof Set ? movedUids : new Set(movedUids ?? []);
  const anchored = fixed instanceof Set ? fixed : new Set(fixed ?? []);
  const cur = new Map();
  for (const [uid, r] of rects) cur.set(uid, { x: r.x, y: r.y, w: r.w, h: r.h });
  const displaced = new Map(); // uid -> displacement order
  const pushers = [...cur.keys()].filter((u) => moved.has(u));
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const [uid, r] of cur) {
      if (moved.has(uid) || anchored.has(uid)) continue;
      const myOrder = displaced.has(uid) ? displaced.get(uid) : Infinity;
      for (const puid of pushers) {
        if (puid === uid) continue;
        if (!moved.has(puid) && displaced.get(puid) >= myOrder) continue;
        const p = cur.get(puid);
        const ox = overlapX(r, p);
        const oy = overlapY(r, p);
        if (ox <= 0 || oy <= 0) continue;
        if (ox <= oy) {
          r.x = r.x + r.w / 2 < p.x + p.w / 2 ? p.x - gap - r.w : p.x + p.w + gap;
        } else {
          r.y = r.y + r.h / 2 < p.y + p.h / 2 ? p.y - gap - r.h : p.y + p.h + gap;
        }
        if (!displaced.has(uid)) { displaced.set(uid, displaced.size); pushers.push(uid); }
        changed = true;
      }
    }
    if (!changed) break;
  }
  return [...displaced.keys()].map((uid) => ({ uid, x: norm(cur.get(uid).x), y: norm(cur.get(uid).y) }));
}

export function sameSize(list, primaryUid, mode = "both") {
  const primary = (list ?? []).find((r) => r.uid === primaryUid);
  if (!primary) return [];
  const out = [];
  for (const r of list) {
    if (r.uid === primaryUid) continue;
    const w = mode === "height" ? r.w : primary.w;
    const h = mode === "width" ? r.h : primary.h;
    if (w !== r.w || h !== r.h) out.push({ uid: r.uid, w, h });
  }
  return out;
}

// Abstract tidy tree: `dd` is size along the depth axis, `bb` along the breadth axis.
function subtree(node, sizeOf, levelGap, sibGap) {
  const { dd, bb } = sizeOf(node);
  const kids = (node.children ?? []).map((c) => ({ c, s: subtree(c, sizeOf, levelGap, sibGap), size: sizeOf(c) }));
  if (!kids.length) return { extent: bb, nodeB: 0, places: [{ uid: node.uid, d: 0, b: 0 }] };
  let cursor = 0;
  const offs = kids.map((k) => { const o = cursor; cursor += k.s.extent + sibGap; return o; });
  const childrenExtent = cursor - sibGap;
  const centerOf = (i) => offs[i] + kids[i].s.nodeB + kids[i].size.bb / 2;
  const parentB = (centerOf(0) + centerOf(kids.length - 1)) / 2 - bb / 2;
  const min = Math.min(0, parentB);
  const max = Math.max(childrenExtent, parentB + bb);
  const places = [{ uid: node.uid, d: 0, b: parentB - min }];
  kids.forEach((k, i) => {
    for (const p of k.s.places) places.push({ uid: p.uid, d: dd + levelGap + p.d, b: offs[i] - min + p.b });
  });
  return { extent: max - min, nodeB: parentB - min, places };
}

export function mindMapLayout(root, { direction = "right", hGap = 80, vGap = 24 } = {}) {
  const out = new Map();
  if (!root) return out;
  const down = direction === "down";
  const sizeOf = down ? (n) => ({ dd: n.h, bb: n.w }) : (n) => ({ dd: n.w, bb: n.h });
  const toXY = (d, b) => (down ? { x: norm(b), y: norm(d) } : { x: norm(d), y: norm(b) });
  const groupPlaces = (kids) => {
    const s = subtree({ ...root, children: kids }, sizeOf, hGap, vGap);
    return s.places.map((p) => ({ uid: p.uid, d: p.d, b: p.b - s.nodeB }));
  };
  const kids = root.children ?? [];
  if (direction === "balanced") {
    const rootDd = sizeOf(root).dd;
    const right = kids.filter((_, i) => i % 2 === 0);
    const left = kids.filter((_, i) => i % 2 === 1);
    out.set(root.uid, { x: 0, y: 0 });
    for (const p of groupPlaces(right)) if (p.uid !== root.uid) out.set(p.uid, toXY(p.d, p.b));
    for (const p of groupPlaces(left)) {
      if (p.uid === root.uid) continue;
      const w = sizeOf(findNode(root, p.uid)).dd;
      out.set(p.uid, toXY(rootDd - (p.d + w), p.b));
    }
    return out;
  }
  for (const p of groupPlaces(kids)) out.set(p.uid, toXY(p.d, p.b));
  return out;
}

function findNode(node, uid) {
  if (node.uid === uid) return node;
  for (const c of node.children ?? []) {
    const f = findNode(c, uid);
    if (f) return f;
  }
  return null;
}
