// Later ideas from roadmap section 6. Pure functions only: no DOM, no writes.
// A countdown, a graph layout, and a thumbnail budget stay in memory.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = /(\d{1,2})(?:st|nd|rd|th)?/;

export const ATTRIBUTE_TEMPLATE = [
  { string: "Owner:: " },
  { string: "Status:: " },
  { string: "Due:: " },
];

export const FOCUS_MS = 25 * 60 * 1000;
export const THUMBNAIL_CAP = 4;
export const VIA_CAP = 8;

export function highlightHits(string) {
  const out = [];
  const re = /\^\^([\s\S]*?)\^\^/g;
  let m;
  const s = String(string ?? "");
  while ((m = re.exec(s))) {
    const text = m[1].trim();
    if (text) out.push(text);
  }
  return out;
}

function imageSrcOf(string) {
  const m = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(String(string ?? ""));
  return m ? m[1] : null;
}

export function galleryItems(board) {
  const out = [];
  for (const item of board?.items?.values?.() || []) {
    if (item.type !== "card") continue;
    const src = item.kind === "image" ? imageSrcOf(item.string) : imageSrcOf(item.string);
    if (item.kind !== "image" && !src) continue;
    out.push({ uid: item.uid, title: item.title || "", src });
  }
  return out;
}

export function galleryGrid(items, { cols = 4, cell = 160, gap = 12 } = {}) {
  const n = Math.max(1, cols);
  return (items || []).map((item, i) => ({
    uid: item.uid,
    title: item.title || "",
    src: item.src || null,
    x: (i % n) * (cell + gap),
    y: Math.floor(i / n) * (cell + gap),
    w: cell,
    h: cell,
  }));
}

export function parseCardDate(item) {
  const title = String(item?.title ?? "").trim();
  const daily = new RegExp(`^(${MONTHS.join("|")})\\s+${DAY.source},\\s+(\\d{4})$`).exec(title);
  if (daily) {
    const month = MONTHS.indexOf(daily[1]);
    const day = Number(daily[2]);
    const year = Number(daily[3]);
    if (month >= 0 && day >= 1 && day <= 31) return Date.UTC(year, month, day);
  }
  const blob = `${title}\n${item?.string ?? ""}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(blob);
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]) - 1;
  const day = Number(iso[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return Date.UTC(year, month, day);
}

export function calendarSlots(cards, { year, month } = {}) {
  const slots = [];
  for (const card of cards || []) {
    const t = parseCardDate(card);
    if (t == null) continue;
    const d = new Date(t);
    if (year != null && d.getUTCFullYear() !== year) continue;
    if (month != null && d.getUTCMonth() !== month) continue;
    slots.push({ uid: card.uid, day: d.getUTCDate(), t, title: card.title || "" });
  }
  slots.sort((a, b) => a.t - b.t || String(a.uid).localeCompare(String(b.uid)));
  return slots;
}

export function calendarLayout(cards, { year, month, x0 = 16, y0 = 48, col = 28 } = {}) {
  return calendarSlots(cards, { year, month }).map((slot) => ({
    uid: slot.uid,
    x: x0 + (slot.day - 1) * col,
    y: y0,
  }));
}

export function timelineAxis(cards, { width = 800 } = {}) {
  const dated = (cards || [])
    .map((card) => ({ card, t: parseCardDate(card) }))
    .filter((row) => row.t != null)
    .sort((a, b) => a.t - b.t || String(a.card.uid).localeCompare(String(b.card.uid)));
  if (!dated.length) return [];
  const min = dated[0].t;
  const span = (dated[dated.length - 1].t - min) || 1;
  return dated.map((row) => ({
    uid: row.card.uid,
    title: row.card.title || "",
    t: row.t,
    x: ((row.t - min) / span) * width,
  }));
}

export function graphLayout(nodes, links, { iterations = 12 } = {}) {
  const ids = [...(nodes || [])];
  const pos = new Map();
  const n = ids.length || 1;
  ids.forEach((id, i) => {
    const a = (Math.PI * 2 * i) / n;
    pos.set(id, { x: Math.cos(a) * 120, y: Math.sin(a) * 120 });
  });
  const steps = Math.max(0, Math.min(40, iterations));
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const dist = Math.sqrt(d2);
        const push = 400 / d2;
        dx /= dist;
        dy /= dist;
        a.x += dx * push;
        a.y += dy * push;
        b.x -= dx * push;
        b.y -= dy * push;
      }
    }
    for (const link of links || []) {
      const a = pos.get(link[0]);
      const b = pos.get(link[1]);
      if (!a || !b) continue;
      a.x += (b.x - a.x) * 0.05;
      a.y += (b.y - a.y) * 0.05;
      b.x += (a.x - b.x) * 0.05;
      b.y += (a.y - b.y) * 0.05;
    }
  }
  return pos;
}

export function derivedGraph(board) {
  const nodes = [];
  const links = [];
  for (const item of board?.items?.values?.() || []) {
    if (item.type === "card") nodes.push(item.uid);
  }
  for (const edge of board?.edges?.values?.() || []) {
    if (edge.valid === false) continue;
    if (!edge.from || !edge.to) continue;
    links.push([edge.from, edge.to]);
  }
  return { nodes, links };
}

export function commentCount(board, uid) {
  const item = board?.items?.get?.(uid);
  if (!item) return 0;
  let n = 0;
  for (const member of item.members || []) {
    const kid = board.items.get(member);
    if (!kid) continue;
    const title = String(kid.title || "").trim();
    const text = `${title} ${kid.string || ""}`.trim();
    if (/^comments?$/i.test(title) && kid.members?.length) n += kid.members.length;
    else if (/\{\{\[\[comment\]\]\}\}|^\[\[comment\]\]|^comment::/i.test(text)) n += 1;
  }
  return n;
}

// Read the blocks a template or SmartBlocks already produced. Skip command wrappers.
export function cardTemplatePlan(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (!block || typeof block.string !== "string") continue;
    const string = block.string.trim();
    if (!string || string.startsWith("{{")) continue;
    out.push({ string: string.slice(0, 500) });
    if (out.length >= 45) break;
  }
  return out;
}

export function cleanVia(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
    out.push({ x: Math.round(Number(p.x) * 10) / 10, y: Math.round(Number(p.y) * 10) / 10 });
    if (out.length >= VIA_CAP) break;
  }
  return out;
}

export function waypointPath(start, via, end) {
  const bends = cleanVia(via);
  const pts = [start, ...bends, end].filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("");
  const mid = pts[Math.floor((pts.length - 1) / 2)] || start;
  return { d, points: pts, mid, start, end };
}

function segmentHits(a, b, rect) {
  const pad = 8;
  const left = rect.x - pad;
  const right = rect.x + rect.w + pad;
  const top = rect.y - pad;
  const bottom = rect.y + rect.h + pad;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX < left || minX > right || maxY < top || minY > bottom) return false;
  return true;
}

// Orthogonal bend above any card the straight segment crosses. Empty when the line is clear.
export function routeAround(start, end, obstacles = []) {
  const hit = (obstacles || []).filter((rect) => rect && segmentHits(start, end, rect));
  if (!hit.length) return [];
  const top = Math.min(...hit.map((rect) => rect.y)) - 28;
  return cleanVia([{ x: start.x, y: top }, { x: end.x, y: top }]);
}

export function sectionPair(uids, getItem) {
  const sections = [];
  for (const uid of uids || []) {
    if (getItem?.(uid)?.type === "section") sections.push(uid);
    if (sections.length === 2) break;
  }
  return sections.length === 2 ? sections : null;
}

export function zoomThreshold(boardValue, settingValue) {
  const pick = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0.05 && n <= 1.5 ? n : null;
  };
  return pick(boardValue) ?? pick(settingValue) ?? 0.45;
}

export function thumbnailBudget(uids, { cap = THUMBNAIL_CAP } = {}) {
  const out = [];
  const seen = new Set();
  const limit = Math.max(0, Math.min(THUMBNAIL_CAP, cap));
  for (const uid of uids || []) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
    if (out.length >= limit) break;
  }
  return out;
}

export function timerStep(state, now) {
  const remaining = Math.max(0, Number(state?.remainingMs) || 0);
  if (!state?.running || !state.endsAt) return { remainingMs: remaining, running: false, endsAt: null };
  const left = Math.max(0, state.endsAt - now);
  return { remainingMs: left, running: left > 0, endsAt: left > 0 ? state.endsAt : null };
}

export function presenterNote(board, uid) {
  const item = board?.items?.get?.(uid);
  if (!item) return "";
  for (const member of item.members || []) {
    const kid = board.items.get(member);
    const raw = kid?.string || kid?.title || "";
    const text = String(raw).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 240);
  }
  return "";
}

export function printPages(board) {
  const items = board?.items;
  if (!items) return [];
  const roots = board.roots || [];
  const sections = roots.map((uid) => items.get(uid)).filter((item) => item?.type === "section");
  const pages = sections.length ? sections : [...items.values()].filter((item) => item.type !== "edge");
  return pages.map((item) => ({ uid: item.uid, title: item.title || item.string || "Untitled" }));
}

export function backgroundImage(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s || s.length > 2000) return null;
  if (!/^https:\/\//i.test(s)) return null;
  if (/[\s"'()<>]/.test(s)) return null;
  return s;
}

// Roam does not document a block-history method. Return a name only when the host actually has one.
export function versionPeekRequest(api) {
  if (!api || typeof api !== "object") return null;
  if (typeof api.block?.history === "function") return "block.history";
  if (typeof api.ui?.blockHistory === "function") return "ui.blockHistory";
  return null;
}
