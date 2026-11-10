// Editing the stress board and typing, on one scratch section this file creates far to the right of all real content.
// Everything written here carries the marker PXD-BENCH and is recorded in a ledger file before it is relied on. Rules:
//  - a press (click, drag, double-click, key that edits) is only sent after the target under the pointer was checked, and
//    a failed check skips the step;
//  - deletes only ever name uids this run created (ledger, or items that did not exist before and sit in the scratch
//    section), and a uid that existed before the run is never deleted;
//  - the section is deleted at the end and the board is compared with the snapshot taken before it was created.
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sleep } from "../lib/cdp.mjs";
import { OUT_DIR, BOARD, PAGE } from "../lib/bench-window.mjs";

export const group = "build";

const MARK = "PXD-BENCH";
const STATE_DIR = join(OUT_DIR, "state");
const BEFORE_FILE = join(STATE_DIR, "scratch-before.json");
const LEDGER_FILE = join(STATE_DIR, "scratch-ledger.jsonl");
const J = (x) => JSON.stringify(x);

// ---- page helpers (geometry, hit tests, board model; installed once per document)
const PAGE_JS = String.raw`(() => {
  if (window.__pxdEdit && window.__pxdEdit.v === 1) return "already";
  const B = __BOARD__;
  const V = () => window.__pxdStress.view();
  const G = () => { const v = V(); if (!v) return null; return { v, rr: v.root.getBoundingClientRect(), vp: v.viewport(), src: v.snapshotSource() }; };
  const BAD = ".pxd-chrome, .pxd-out, .pxd-port, .pxd-grip, .pxd-edge, .pxd-label, .pxd-link, .pxd-section__title, .pxd-section__edge, .pxd-item, .pxd-btn, button, a, input, textarea, select, [contenteditable]";
  const central = (g, x, y, m = 90) => x > g.rr.left + m && x < g.rr.right - m && y > g.rr.top + m && y < g.rr.bottom - m;
  const world = (g, x, y) => ({ x: (x - g.rr.left - g.vp.x) / g.vp.zoom, y: (y - g.rr.top - g.vp.y) / g.vp.zoom });
  const pt = (wx, wy) => { const g = G(); if (!g) return null; return { x: Math.round(g.rr.left + wx * g.vp.zoom + g.vp.x), y: Math.round(g.rr.top + wy * g.vp.zoom + g.vp.y), zoom: g.vp.zoom }; };
  const box = () => { const g = G(); return g ? { x: g.rr.left, y: g.rr.top, w: g.rr.width, h: g.rr.height, zoom: g.vp.zoom, vx: g.vp.x, vy: g.vp.y, lod: g.v.root.getAttribute("data-pxd-lod") } : null; };
  // plain board surface at a page point: nothing but background within pad px of it (same rule as the move scenarios)
  const empty = (x, y, pad = 14) => {
    const g = G(); if (!g || !g.src) return false;
    const { v, rr, vp, src } = g;
    if (!central(g, x, y, 40)) return false;
    const surface = v.root.querySelector(".pxd-viewport");
    const el = document.elementFromPoint(x, y);
    if (!el || !surface || !surface.contains(el) || el.closest(BAD)) return false;
    const wx = (x - rr.left - vp.x) / vp.zoom, wy = (y - rr.top - vp.y) / vp.zoom, p = pad / vp.zoom, tb = 28 / vp.zoom;
    for (const [uid, it] of src.board.items) {
      const r = src.rects.get(uid); if (!r) continue;
      if (it.type === "section") {
        if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - tb - p && wy <= r.y + p) return false;
        const outer = wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p;
        const inner = wx >= r.x + p && wx <= r.x + r.w - p && wy >= r.y + p && wy <= r.y + r.h - p;
        if (outer && !inner) return false;
      } else if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p) return false;
    }
    return true;
  };
  const findEmpty = (cx, cy) => {
    const g = G(); if (!g) return null;
    if (cx == null) { cx = g.rr.left + g.rr.width / 2; cy = g.rr.top + g.rr.height / 2; }
    for (let ring = 0; ring <= 16; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const x = cx + i * 26, y = cy + j * 26;
      if (empty(x, y) && central(g, x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  };
  // the card's own surface: shell, body, header, or a plain text element in the body that is not interactive
  const NOT_PLAIN = "a, button, input, textarea, select, [contenteditable], [data-link-uid], .rm-page-ref, .rm-block-ref, .pxd-btn, .pxd-port, .pxd-grip, [data-pxd-row], .pxd-link, .pxd-task-check, .rm-checkbox, .check-container";
  const plainEl = (el, sh) => {
    if (!el || !sh) return false;
    const body = sh.querySelector(".pxd-item__body");
    if (el === sh || el === body || el.classList.contains("pxd-item__header")) return true;
    return !!(body && body.contains(el) && !el.closest(NOT_PLAIN) && el.closest(".pxd-item") === sh);
  };
  // what is under a page point, in the view's own terms (grips carry part, ports carry side)
  const at = (x, y) => {
    const g = G(); const el = document.elementFromPoint(x, y);
    if (!g || !el || !g.v.root.contains(el)) return { kind: "outside" };
    const c = (s) => el.closest(s);
    if (c(".pxd-chrome, .pxd-btn")) return { kind: "chrome" };
    for (const [k, s] of [["port", ".pxd-port"], ["grip", ".pxd-grip"], ["label", ".pxd-label"], ["edge", ".pxd-edge"], ["link", ".pxd-link"], ["section-title", ".pxd-section__title"], ["section-border", ".pxd-section__edge"]]) {
      const n = c(s);
      if (n) {
        const o = n.closest("[data-uid]");
        const r = { kind: k, uid: o ? o.getAttribute("data-uid") : null };
        if (k === "grip") r.part = n.getAttribute("data-part");
        if (k === "port") r.side = n.getAttribute("data-side");
        return r;
      }
    }
    const it = c(".pxd-item");
    if (it) { return { kind: "item", uid: it.getAttribute("data-uid"), plain: plainEl(el, it) }; }
    return { kind: empty(x, y) ? "empty" : "near" };
  };
  // A page point inside the scratch rect (shrunk by pad world px), on plain surface, and at least 20 screen px away from
  // every item rect except the scratch section itself.
  const inScratch = (x, y, rect, pad, skipUid) => {
    const g = G(); if (!g || !g.src || !rect) return false;
    if (!central(g, x, y, 40)) return false;
    const w = world(g, x, y), m = 20 / g.vp.zoom;
    if (w.x < rect.x + pad || w.x > rect.x + rect.w - pad || w.y < rect.y + pad || w.y > rect.y + rect.h - pad) return false;
    const surface = g.v.root.querySelector(".pxd-viewport");
    const el = document.elementFromPoint(x, y);
    if (!el || !surface || !surface.contains(el) || el.closest(BAD)) return false;
    for (const [uid, r] of g.src.rects) {
      if (uid === skipUid) continue;
      if (r.x > rect.x + rect.w + m || r.x + r.w < rect.x - m || r.y > rect.y + rect.h + m || r.y + r.h < rect.y - m) continue;
      if (w.x >= r.x - m && w.x <= r.x + r.w + m && w.y >= r.y - m && w.y <= r.y + r.h + m) return false;
    }
    return true;
  };
  // nearest in-scratch point to (cx, cy) (default the board centre) that is also on screen clear of the chrome
  const findIn = (rect, pad, skipUid, cx, cy) => {
    const g = G(); if (!g) return null;
    if (cx == null) { cx = g.rr.left + g.rr.width / 2; cy = g.rr.top + g.rr.height / 2; }
    for (let ring = 0; ring <= 20; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const x = cx + i * 26, y = cy + j * 26;
      if (central(g, x, y) && inScratch(x, y, rect, pad, skipUid)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  };
  // a point on the card's own surface (never a link, row, checkbox or handle); null when it has no shell on screen
  const cardPoint = (uid) => {
    const g = G(); if (!g || !g.src) return null;
    const sh = g.v.root.querySelector('.pxd-item[data-uid="' + uid + '"]'); if (!sh) return null;
    const b = sh.getBoundingClientRect(); if (b.width < 30 || b.height < 20) return null;
    for (const [fx, fy] of [[b.width / 2, b.height / 2], [7, 7], [b.width - 7, 7], [7, b.height - 7], [b.width - 7, b.height - 7], [b.width / 2, 7]]) {
      const x = b.left + fx, y = b.top + fy; if (!central(g, x, y)) continue;
      if (plainEl(document.elementFromPoint(x, y), sh)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  };
  // centre of a displayed port or grip of that card (they only display while the card is hovered or selected)
  const handle = (uid, sel) => {
    const v = V(); if (!v) return null;
    const sh = v.root.querySelector('.pxd-item[data-uid="' + uid + '"]'); if (!sh) return null;
    const n = sh.querySelector(sel); if (!n) return null;
    const b = n.getBoundingClientRect(); if (!b.width || !b.height) return null;
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  };
  const titlePoint = (uid) => {
    const g = G(); if (!g) return null;
    const s = g.v.root.querySelector('.pxd-section[data-uid="' + uid + '"]'); if (!s) return null;
    const t = s.querySelector(".pxd-section__title"); if (!t) return null;
    const b = t.getBoundingClientRect(); if (!b.width || !b.height) return null;
    const x = b.left + b.width / 2, y = b.top + b.height / 2; if (!central(g, x, y, 40)) return null;
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest(".pxd-section__title")) return null;
    return { x: Math.round(x), y: Math.round(y) };
  };
  const sel = () => { const v = V(); const s = v && v.state ? v.state() : null; return s ? s.selection : null; };
  const item = (uid) => { const g = G(); if (!g || !g.src) return null; const it = g.src.board.items.get(uid); if (!it) return null; return { uid, type: it.type, kind: it.kind, string: it.string, parentUid: it.parentUid || null, rect: g.src.rects.get(uid) || null }; };
  const rectOf = (uid) => { const g = G(); return g && g.src ? g.src.rects.get(uid) || null : null; };
  const stringOf = (uid) => { const g = G(); if (!g || !g.src) return null; const it = g.src.board.items.get(uid); return it ? it.string : null; };
  // uid of the board card whose editor textarea has focus ("" when none, "?" for a textarea that is in the board but not in a card)
  const editing = () => {
    const v = V(); const a = document.activeElement;
    if (!a || a.tagName !== "TEXTAREA" || !v || !v.root.contains(a)) return "";
    const it = a.closest(".pxd-item[data-uid]");
    return it ? it.getAttribute("data-uid") : "?";
  };
  const fieldFocused = () => { const a = document.activeElement; return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)); };
  const searchFocused = () => { const a = document.activeElement; return !!(a && a.closest && a.closest(".pxd-search")); };
  const searchInputFocused = () => { const a = document.activeElement; return !!(a && a.tagName === "INPUT" && a.closest && a.closest(".pxd-search")); };
  // caret to the end of the focused editor (programmatic, no key event) so typed text appends after the marker
  const caretEnd = (uid) => {
    const a = document.activeElement; if (!a || a.tagName !== "TEXTAREA") return false;
    const it = a.closest(".pxd-item[data-uid]"); if (!it || it.getAttribute("data-uid") !== uid) return false;
    const n = a.value.length; a.setSelectionRange(n, n); return true;
  };
  const blockCaretEnd = (uid) => {
    const a = document.activeElement; if (!a || a.tagName !== "TEXTAREA" || !a.id || !a.id.endsWith("-" + uid)) return false;
    const n = a.value.length; a.setSelectionRange(n, n); return true;
  };
  const focusedBlock = (uid) => { const a = document.activeElement; return !!(a && a.tagName === "TEXTAREA" && a.id && a.id.endsWith("-" + uid)); };
  // a point on a plain Roam block of the page (outside the board), scrolled to the middle of the window
  const blockPoint = (uid) => {
    const el = document.querySelector('.roam-article [id$="-' + uid + '"]'); if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const x = Math.round(r.left + Math.min(24, r.width / 2)), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y); const v = V();
    if (!hit || !el.contains(hit) || (v && v.root.contains(hit))) return null;
    return { x, y };
  };
  // scroll the board's root back into view: first the root itself, then the nearest scrollable ancestor so its top is ~60 px down
  const reveal = () => {
    const v = V(); if (!v) return false;
    const root = v.root;
    root.scrollIntoView({ block: "start" });
    let r = root.getBoundingClientRect();
    if (r.top < 0 || r.top > innerHeight - 100) {
      for (let n = root.parentElement; n; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 4) { n.scrollTop += root.getBoundingClientRect().top - 60; r = root.getBoundingClientRect(); if (r.top >= 0 && r.top < innerHeight - 100) break; }
      }
    }
    r = root.getBoundingClientRect();
    return r.top >= -1 && r.top < innerHeight - 100;
  };
  const boardInView = () => { const v = V(); if (!v) return false; const r = v.root.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const paste = (text) => {
    if (fieldFocused()) return false;
    const dt = new DataTransfer(); dt.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  };
  // the whole board model through a session: [uid, type, parentUid, x, y, w, h, string[0..60]] and [uid, from, to]
  const snapshot = () => {
    const s = window.__plexusDiagram && window.__plexusDiagram.session(B); if (!s) return null;
    try {
      const b = s.board, rects = s.rects; if (!b) return null;
      const items = [], edges = [];
      for (const [uid, it] of b.items) { const r = rects && rects.get(uid); items.push([uid, it.type, it.parentUid || null, r ? r.x : null, r ? r.y : null, r ? r.w : null, r ? r.h : null, String(it.string || "").slice(0, 60)]); }
      for (const [uid, e] of b.edges) edges.push([uid, e.from, e.to]);
      return { items, edges };
    } finally { s.release(); }
  };
  window.__pxdEdit = { v: 1, pt, box, empty, findEmpty, at, inScratch, findIn, cardPoint, handle, titlePoint, sel, item, rectOf, stringOf, editing, fieldFocused, searchFocused, searchInputFocused, caretEnd, blockCaretEnd, focusedBlock, blockPoint, boardInView, reveal, paste, snapshot };
  return "installed";
})()`.replace("__BOARD__", J(BOARD));

const E = "window.__pxdEdit";
const install = (ctx) => ctx.c.ev(PAGE_JS);
const page = (ctx, expr) => ctx.c.evJson(`JSON.stringify(${E}.${expr} ?? null)`);

// ---- small stats and measured-window helpers (copied from move.mjs)
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const pq = (a, p) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : null; };
const dist = (a) => ({ n: a.filter((x) => x != null).length, p50: med(a), p90: pq(a, 0.9), max: a.some((x) => x != null) ? Math.max(...a.filter((x) => x != null)) : null });
const band = (z) => (z == null ? "none" : z < 0.2 ? "map" : z < 0.6 ? "overview" : z < 0.9 ? "small" : z < 1.3 ? "reading" : "close");
// Event Timing rows only exist from 16 ms up: a missing row means the event painted faster than that.
const FAST = 12;
const evd = (sum, name) => { const r = (sum?.input?.events || []).filter((e) => e.n === name); return r.length ? Math.max(...r.map((e) => e.d)) : null; };
const evAll = (sum, name, tg, n = 0) => { const d = (sum?.input?.events || []).filter((e) => e.n === name && String(e.tg || "").startsWith(tg)).map((e) => e.d); while (d.length < n) d.push(FAST); return d; };

// A Plexus background job freezes the page about 1 s after an edit goes quiet: after every edit the window stays open.
const SETTLE = { settle: 2500, max: 15000 };
async function step(ctx, label, fn, { wait = 430, content = true, settle = 150, max = 2500 } = {}) {
  await ctx.probe.arm({ label, content });
  await fn();
  await sleep(wait);
  if (settle) await ctx.probe.quiet({ gap: settle, max });
  const sum = await ctx.probe.take();
  sum.label = label;
  return sum;
}
const estep = (ctx, label, fn, o = {}) => step(ctx, label, fn, { ...SETTLE, ...o });
const row = (sum, more = {}) => ({
  label: sum.label, z0: sum.c0?.zoom ?? null, z1: sum.c1?.zoom ?? null, band: band(sum.c1?.zoom), lod: sum.c1?.lod ?? null,
  down: evd(sum, "pointerdown"), up: evd(sum, "pointerup"), click: evd(sum, "click"), ttnp: sum.ttnp,
  stalls: sum.stalls.n, stallMs: Math.round(sum.stalls.total), worst: Math.round(sum.stalls.worst),
  fp95: sum.frames?.p95 ?? null, fmax: sum.frames?.max ?? null, over50: sum.frames?.over50 ?? 0,
  maxEmpty: sum.content?.maxEmpty ?? null, maxMissing: sum.content?.maxMissing ?? null, ...more,
});
// one Summary for a scenario made of several steps: stalls add up, worst cases win
function merge(label, sums) {
  const list = sums.flatMap((s) => s.stalls.list.map((f) => ({ ...f, step: s.label }))).sort((a, b) => b.d - a.d).slice(0, 40);
  const sum = (f) => sums.reduce((a, s) => a + (f(s) || 0), 0), mx = (f) => sums.reduce((a, s) => Math.max(a, f(s) || 0), 0);
  const cs = sums.map((s) => s.content).filter(Boolean);
  const cd = (k) => ({ n: cs.reduce((a, c) => a + (c[k]?.n || 0), 0), p50: med(cs.map((c) => c[k]?.p50)), p95: cs.reduce((a, c) => Math.max(a, c[k]?.p95 || 0), 0) || null, max: cs.reduce((a, c) => Math.max(a, c[k]?.max || 0), 0) || null });
  const last = sums[sums.length - 1] || {};
  return {
    label, ms: Math.round(sum((s) => s.ms)), steps: sums.length,
    stalls: { n: sum((s) => s.stalls.n), total: Math.round(sum((s) => s.stalls.total)), worst: Math.round(mx((s) => s.stalls.worst)), list },
    long: { n: sum((s) => s.long.n), total: Math.round(sum((s) => s.long.total)), worst: Math.round(mx((s) => s.long.worst)) },
    frames: { n: sum((s) => s.frames?.n), p50: med(sums.map((s) => s.frames?.p50)), p95: mx((s) => s.frames?.p95), p99: mx((s) => s.frames?.p99), max: mx((s) => s.frames?.max), over34: sum((s) => s.frames?.over34), over50: sum((s) => s.frames?.over50), over100: sum((s) => s.frames?.over100) },
    input: { n: sum((s) => s.input?.n), events: sums.flatMap((s) => (s.input?.events || []).map((e) => ({ ...e, step: s.label }))).sort((a, b) => b.d - a.d).slice(0, 60), wheel: { n: sum((s) => s.input?.wheel?.n), p95: mx((s) => s.input?.wheel?.p95), max: mx((s) => s.input?.wheel?.max) } },
    ttnp: med(sums.map((s) => s.ttnp)),
    content: cs.length ? { samples: cs.reduce((a, c) => a + c.samples, 0), cost: Math.round(cs.reduce((a, c) => a + c.cost, 0)), maxMissing: Math.max(...cs.map((c) => c.maxMissing)), maxEmpty: Math.max(...cs.map((c) => c.maxEmpty)), entered: cs.reduce((a, c) => a + c.entered, 0), readable: cd("readable"), live: cd("live"), neverReadable: cs.reduce((a, c) => a + c.neverReadable, 0), neverLive: cs.reduce((a, c) => a + c.neverLive, 0), leftBeforeLive: cs.reduce((a, c) => a + c.leftBeforeLive, 0), end: cs[cs.length - 1].end } : null,
    marks: [], c0: sums[0]?.c0 ?? null, c1: last.c1 ?? null,
    plexus: { longTasks: sums.flatMap((s) => s.plexus?.longTasks || []), slowMounts: sums.flatMap((s) => s.plexus?.slowMounts || []), paintAudit: last.plexus?.paintAudit ?? null, bgOverruns: last.plexus?.bgOverruns ?? null },
  };
}
// stalls that start more than 600 ms after the last input: the background job that follows an edit
function tailOf(sums) {
  let n = 0, ms = 0, worst = 0;
  for (const s of sums.filter(Boolean)) {
    const base = s.input?.lastAt ?? 0;
    for (const f of s.stalls?.list || []) if (f.st - base > 600) { n++; ms += f.d; worst = Math.max(worst, f.d); }
  }
  return { n, ms: Math.round(ms), worst: Math.round(worst) };
}

// ---- scratch state (module level, shared by the scenarios of one run)
const newS = () => ({ run: null, section: null, origin: null, rect: null, before: null, ledger: [], cards: {}, grid: [], edge: null, selfClean: false });
let S = newS();
let cleanupRegistered = false;
const TOL = 300; // autofit may grow the section a little beyond the rect it was created with

const WO = (dx, dy) => ({ x: S.origin.x + dx, y: S.origin.y + dy });
const GRID = { x: 1250, y: 160, cw: 130, ch: 60, gap: 24, cols: 10, rows: 5 };

async function ledger(uid, kind) {
  if (!uid || S.ledger.includes(uid)) return;
  S.ledger.push(uid);
  await mkdir(STATE_DIR, { recursive: true });
  await appendFile(LEDGER_FILE, JSON.stringify({ at: new Date().toISOString(), run: S.run, uid, kind }) + "\n");
}
async function readLedger() {
  try {
    const out = [];
    for (const line of (await readFile(LEDGER_FILE, "utf8")).split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r && typeof r.uid === "string") out.push(r); } catch { /* torn line */ } }
    return out;
  } catch { return []; }
}
async function readBefore() {
  try { const j = JSON.parse(await readFile(BEFORE_FILE, "utf8")); return { items: new Set(j.items || []), edges: new Set(j.edges || []) }; } catch { return null; }
}

// the board model: items Map uid -> {uid, type, parentUid, rect, string}, edges Map uid -> {uid, from, to}, kids Map parent -> [uids]
async function readSnap(ctx) {
  await install(ctx);
  const r = await page(ctx, "snapshot()");
  if (!r) throw new Error("board model not available (no session)");
  const items = new Map(), edges = new Map(), kids = new Map();
  for (const [uid, type, parentUid, x, y, w, h, string] of r.items) {
    items.set(uid, { uid, type, parentUid, rect: x == null ? null : { x, y, w, h }, string });
    if (parentUid) { if (!kids.has(parentUid)) kids.set(parentUid, []); kids.get(parentUid).push(uid); }
  }
  for (const [uid, from, to] of r.edges) edges.set(uid, { uid, from, to });
  return { items, edges, kids };
}
function descendantsOf(snap, uid) {
  const out = [], stack = [...(snap.kids.get(uid) || [])];
  while (stack.length) { const u = stack.pop(); out.push(u); for (const k of snap.kids.get(u) || []) stack.push(k); }
  return out;
}
const inRect = (r, rect, tol) => !!r && !!rect && r.x >= rect.x - tol && r.y >= rect.y - tol && r.x + r.w <= rect.x + rect.w + tol && r.y + r.h <= rect.y + rect.h + tol;
// true for an item this run created: in the ledger, or new since the snapshot and inside the scratch section
function mineIn(snap, uid) {
  if (S.ledger.includes(uid)) return true;
  const it = snap.items.get(uid);
  if (!it || !S.before || S.before.items.has(uid)) return false;
  return it.parentUid === S.section || inRect(it.rect, S.rect, TOL);
}
// items not in the snapshot taken before, not in the ledger yet, that this run's actions made (inside the scratch section,
// or carrying the marker). The caller ledgers them at once.
async function newItems(ctx) {
  const snap = await readSnap(ctx);
  const out = [];
  for (const [uid, it] of snap.items) {
    if (S.before.items.has(uid) || S.ledger.includes(uid)) continue;
    if (it.parentUid === S.section || inRect(it.rect, S.rect, TOL) || String(it.string).startsWith(MARK)) out.push(uid);
  }
  return out;
}
async function claimNew(ctx) {
  const uids = await newItems(ctx);
  for (const u of uids) await ledger(u, "item");
  return uids;
}

// ---- session writes (the session is shared with the open view; always released)
async function sess(ctx, body) {
  return ctx.c.evJson(`(async () => { const s = window.__plexusDiagram && window.__plexusDiagram.session(${J(BOARD)}); if (!s) throw new Error("no session for the board");
    try { if (!s.board) throw new Error("board not loaded in the session"); const out = await (async () => { ${body} })(); return JSON.stringify(out === undefined ? null : out); } finally { s.release(); } })()`);
}
// ---- Roam side
const roam = (ctx, expr) => ctx.c.evJson(`(async () => JSON.stringify((await (${expr})) ?? null))()`);
const MARKER_Q = `[:find ?u :where [?p :block/uid "${PAGE}"] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [(clojure.string/starts-with? ?s "${MARK}")]]`;
async function findMarker(ctx) {
  const r = await roam(ctx, `window.roamAlphaAPI.data.q(${J(MARKER_Q)})`);
  return (r || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean);
}
const existing = async (ctx, uids) => (uids.length ? roam(ctx, `${J(uids)}.filter((u) => window.roamAlphaAPI.data.pull("[:db/id]", [":block/uid", u]))`) : []);
const subtree = (ctx, uid) => roam(ctx, `window.roamAlphaAPI.data.pull("[:block/uid :block/string {:block/children ...}]", [":block/uid", ${J(uid)}])`);
function flattenTree(t, out = []) { for (const k of (t && t[":block/children"]) || []) { out.push({ uid: k[":block/uid"], string: k[":block/string"] || "" }); flattenTree(k, out); } return out; }

// ---- cleanup (exported)
export async function cleanupAll(ctx) {
  try { await install(ctx); } catch { /* page may be busy; the Roam path below does not need it */ }
  const before = S.before || (await readBefore());
  const found = new Set(await findMarker(ctx));
  const led = new Set([...S.ledger, ...(await readLedger()).map((r) => r.uid)]);
  for (const u of await existing(ctx, [...led])) found.add(u);
  const refused = [];
  const handled = new Set();
  let snap = null;
  try { snap = await readSnap(ctx); } catch { snap = null; }
  if (snap) {
    const itemUids = [...found].filter((u) => snap.items.has(u));
    const hasAncestorIn = (u) => { let p = snap.items.get(u)?.parentUid, n = 0; while (p && n++ < 500) { if (found.has(p) && snap.items.has(p)) return true; p = snap.items.get(p)?.parentUid; } return false; };
    const tops = itemUids.filter((u) => !hasAncestorIn(u));
    const ok = [];
    for (const u of tops) {
      const all = [u, ...descendantsOf(snap, u)];
      // a uid from before the run is never deleted; without a snapshot every descendant must be a known leftover
      const bad = all.filter((d) => (before ? before.items.has(d) : !found.has(d)));
      if (bad.length) { refused.push({ uid: u, why: "holds items that existed before the run", items: bad.slice(0, 5) }); continue; }
      ok.push(u);
      for (const d of all) handled.add(d);
    }
    if (ok.length) {
      await ctx.writes(ok.length * 2 + [...handled].length + 4);
      await sess(ctx, `await s.deleteItems(${J(ok)}, { withContents: true, force: true }); await s.idle();`);
    }
    const snap2 = await readSnap(ctx);
    const edgeLeft = [...found].filter((u) => snap2.edges.has(u));
    if (edgeLeft.length) {
      await ctx.writes(edgeLeft.length * 2 + 2);
      await sess(ctx, `await s.deleteEdges(${J(edgeLeft)}); await s.idle();`);
    }
    for (const u of edgeLeft) handled.add(u);
  }
  // whatever is left (typing block, board closed): the Roam API, with a look at what a delete would take with it
  const refusedSet = new Set(refused.flatMap((r) => [r.uid, ...(r.items || [])]));
  let rest = await existing(ctx, [...found].filter((u) => !refusedSet.has(u)));
  const itemsNow = snap ? await readSnap(ctx).catch(() => null) : null;
  for (const u of rest) {
    if (itemsNow && (itemsNow.items.has(u) || itemsNow.edges.has(u)) && handled.has(u)) continue; // the session is still removing it
    if (itemsNow && itemsNow.items.has(u) && refusedSet.has(u)) continue;
    const kids = flattenTree(await subtree(ctx, u));
    const bad = kids.filter((k) => !found.has(k.uid) && !String(k.string).startsWith(MARK));
    if (bad.length) { refused.push({ uid: u, why: "block has children that are not ours", items: bad.slice(0, 5).map((k) => k.uid) }); continue; }
    await ctx.writes(kids.length + 2);
    await roam(ctx, `window.roamAlphaAPI.data.block.delete({ block: { uid: ${J(u)} } })`);
  }
  // wait up to 2 s for the deletes to land
  let left = [];
  for (let i = 0; i < 8; i++) {
    left = await existing(ctx, [...found]);
    if (!left.length) break;
    await sleep(250);
  }
  return { found: found.size, deleted: found.size - left.length, left, refused };
}

export async function verifyClean(ctx) {
  const before = S.before || (await readBefore());
  if (!before) throw new Error("verifyClean: no scratch-before snapshot to compare with");
  const marker = await findMarker(ctx);
  const ledgerUids = [...new Set([...S.ledger, ...(await readLedger()).map((r) => r.uid)])];
  const ledgerLeft = await existing(ctx, ledgerUids);
  let snap = null;
  try { snap = await readSnap(ctx); } catch { snap = null; }
  const res = { markerBlocks: marker.length, ledgerLeft, itemsAdded: null, itemsMissing: null, edgesAdded: null, edgesMissing: null, clean: false };
  if (!snap) { res.why = "board model not available"; return res; }
  res.itemsAdded = [...snap.items.keys()].filter((u) => !before.items.has(u));
  res.itemsMissing = [...before.items].filter((u) => !snap.items.has(u));
  res.edgesAdded = [...snap.edges.keys()].filter((u) => !before.edges.has(u));
  res.edgesMissing = [...before.edges].filter((u) => !snap.edges.has(u));
  res.clean = marker.length === 0 && !ledgerLeft.length && !res.itemsAdded.length && !res.itemsMissing.length && !res.edgesAdded.length && !res.edgesMissing.length;
  if (res.itemsMissing.length || res.edgesMissing.length) {
    const e = new Error(`SERIOUS: board items missing after the scratch run: items ${res.itemsMissing.slice(0, 10).join(",") || "-"} (${res.itemsMissing.length}); edges ${res.edgesMissing.slice(0, 10).join(",") || "-"} (${res.edgesMissing.length})`);
    e.clean = res;
    throw e;
  }
  return res;
}

// ---- the scratch section
async function onBoard(ctx, uid) { return !!(uid && (await page(ctx, `rectOf(${J(uid)})`))); }

// `around(fn)` lets build-setup put the createSection call inside its measured window.
async function ensureScratch(ctx, { around = null, selfClean = false } = {}) {
  await install(ctx);
  if (S.section && (await onBoard(ctx, S.section))) return S.section;
  if (S.section) S = newS(); // gone (undone or deleted from outside): start over
  S.run = "e" + Date.now().toString(36);
  S.selfClean = !!selfClean;
  if (!cleanupRegistered) { ctx.onCleanup(() => cleanupAll(ctx), "stress scratch cleanup"); cleanupRegistered = true; }
  const swept = await cleanupAll(ctx);
  if (swept.left.length) throw new Error(`leftovers of an earlier run could not be removed: ${swept.left.slice(0, 10).join(",")}${swept.refused.length ? "; refused: " + J(swept.refused).slice(0, 300) : ""}`);
  const snap = await readSnap(ctx);
  S.before = { items: new Set(snap.items.keys()), edges: new Set(snap.edges.keys()) };
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(BEFORE_FILE, J({ at: new Date().toISOString(), run: S.run, items: [...S.before.items], edges: [...S.before.edges] }));
  // placement: far right of everything, with a wide empty margin around it
  let right = -Infinity, top = Infinity;
  const rects = [];
  for (const it of snap.items.values()) if (it.rect) { rects.push(it.rect); right = Math.max(right, it.rect.x + it.rect.w); top = Math.min(top, it.rect.y); }
  if (!rects.length) { right = 0; top = 0; }
  const gridRight = GRID.x + GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gap;
  const size = { w: Math.max(2600, gridRight + 140), h: 2600 };
  let ox = right + 3000, found = false;
  for (let i = 0; i < 6 && !found; i++, ox += 3000) {
    const g = { x: ox - 1500, y: top - 1500, w: size.w + 3000, h: size.h + 3000 };
    if (!rects.some((r) => r.x < g.x + g.w && r.x + r.w > g.x && r.y < g.y + g.h && r.y + r.h > g.y)) { found = true; break; }
  }
  if (!found) throw new Error("no free place for the scratch section to the right of the board");
  S.origin = { x: Math.round(ox), y: Math.round(top) };
  S.rect = { x: S.origin.x, y: S.origin.y, w: size.w, h: size.h };
  const create = async () => {
    await ctx.writes(2);
    const uid = await sess(ctx, `const u = await s.createSection({ rect: ${J(S.rect)}, title: ${J(MARK + " scratch (safe to delete)")} }); await s.idle(); return u;`);
    if (!uid) throw new Error("createSection returned no uid");
    if (S.before.items.has(uid)) throw new Error("createSection returned a uid that existed before");
    S.section = uid;
    await ledger(uid, "section");
    return uid;
  };
  const uid = around ? await around(create) : await create();
  if (!(await onBoard(ctx, uid))) { await sleep(1000); if (!(await onBoard(ctx, uid))) throw new Error("the scratch section is not on the board after createSection"); }
  // top-left of the section 90 px below and right of the board's corner, clear of the toolbar
  await ctx.show({ x: 90 - (S.origin.x + 40), y: 90 - (S.origin.y + 40), zoom: 1 });
  await install(ctx);
  return uid;
}

// camera so that the world point (wx, wy) is at the given fraction of the board
async function look(ctx, wx, wy, zoom = 1, fx = 0.5, fy = 0.5) {
  const b = await page(ctx, "box()");
  if (!b) throw new Error("board view not available");
  await ctx.show({ x: b.w * fx - wx * zoom, y: b.h * fy - wy * zoom, zoom });
  await install(ctx);
}
async function gate(ctx) {
  await install(ctx);
  if (!S.section || !S.before) return "no scratch section (run build-setup first)";
  if (!(await onBoard(ctx, S.section))) return "the scratch section is not on the board";
  return null;
}
// ---- guards
async function hoverGuard(ctx, p, want, wait = 80) {
  await ctx.input.move(p.x, p.y);
  await sleep(wait);
  return pressGuard(ctx, p, want);
}
async function pressGuard(ctx, p, want) {
  const t = await page(ctx, `at(${p.x}, ${p.y})`);
  return !!(t && want(t)) && t;
}
const inScr = (ctx, p, pad = 40) => page(ctx, `inScratch(${p.x}, ${p.y}, ${J(S.rect)}, ${pad}, ${J(S.section)})`);
// an empty in-scratch point that was checked twice (geometry, then what is under the pointer once it is there)
async function emptyScratchPoint(ctx, cx, cy) {
  const p = await page(ctx, `findIn(${J(S.rect)}, 40, ${J(S.section)}, ${cx ?? "null"}, ${cy ?? "null"})`);
  if (!p) return null;
  if (!(await hoverGuard(ctx, p, (t) => t.kind === "empty"))) return null;
  if (!(await inScr(ctx, p))) return null;
  return p;
}
async function selNow(ctx) { return (await page(ctx, "sel()")) || []; }
async function clearSel(ctx) {
  if (!(await selNow(ctx)).length) return true;
  const p = await emptyScratchPoint(ctx);
  if (p) { await hold(ctx, p.x, p.y); await sleep(250); }
  if (!(await selNow(ctx)).length) return true;
  await ctx.input.key("Escape");
  await sleep(250);
  return !(await selNow(ctx)).length;
}
// a held press: a zero-length click right after a camera change was dropped live
async function hold(ctx, x, y) {
  await ctx.input.move(x, y);
  await sleep(80);
  await ctx.input.down(x, y);
  await sleep(120);
  await ctx.input.up(x, y);
}
const rectNow = (ctx, uid) => page(ctx, `rectOf(${J(uid)})`);
const itemNow = (ctx, uid) => page(ctx, `item(${J(uid)})`);
async function zoomNow(ctx) { return ((await page(ctx, "box()")) || {}).zoom || 1; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const finish = (sum, extra, ttnp, sent = true) => ({ summary: sum, ttnp: sent ? (ttnp ?? FAST) : null, extra: { ...extra, tail: tailOf([sum]) } });

// ---- scenarios
async function buildSetup(ctx) {
  await install(ctx);
  if (S.section && (await onBoard(ctx, S.section))) return { skip: "a scratch section already exists in this run (run build-cleanup first)" };
  let sum = null;
  await ensureScratch(ctx, {
    around: async (create) => {
      let uid = null;
      sum = await estep(ctx, "createSection", async () => { await ctx.probe.act(); uid = await create(); });
      return uid;
    },
  });
  return finish(sum, { ok: true, section: S.section, origin: S.origin, items: S.before.items.size, edges: S.before.edges.size }, sum.ttnp);
}

async function addCard(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const c = WO(500, 300);
  await look(ctx, c.x, c.y);
  const p = await page(ctx, `pt(${S.origin.x + 200}, ${S.origin.y + 230})`);
  if (!p || !(await inScr(ctx, p))) return { skip: "the point for card A is not clear scratch background" };
  await ctx.input.move(p.x, p.y);
  await sleep(80);
  let sent = false, typed = false, why = null, editor = "";
  const text = MARK + " add";
  const sum = await estep(ctx, "add-card", async () => {
    if (!(await pressGuard(ctx, p, (t) => t.kind === "empty"))) { why = "the point stopped being empty background"; return; }
    sent = true;
    await ctx.input.dblclick(p.x, p.y);
    for (let i = 0; i < 30 && !editor; i++) { await sleep(100); editor = await page(ctx, "editing()"); }
    // type only into a card that did not exist before the run
    if (!editor || editor === "?" || S.before.items.has(editor)) {
      why = editor ? "an existing card (or no card) took the editor" : "no editor opened within 3 s";
      if (editor) {
        await ctx.input.key("Escape");
        await sleep(300);
        const still = await page(ctx, "editing()");
        why += still ? "; editor still open after Escape" : "; left with Escape";
      }
      return;
    }
    await ctx.input.type(text, { interval: 70 });
    typed = true;
    await ctx.input.key("Escape");
  }, { wait: 600 });
  const made = await claimNew(ctx);
  let uid = null, ok = false;
  if (made.length === 1) uid = made[0];
  else why = why || `${made.length} new items appeared`;
  if (uid) {
    for (let i = 0; i < 40; i++) { const s = await page(ctx, `stringOf(${J(uid)})`); if (typeof s === "string" && s.startsWith(MARK)) { ok = true; break; } await sleep(100); }
    if (!ok) {
      await ctx.writes(2);
      await sess(ctx, `await s.setString(${J(uid)}, ${J(text)}); await s.idle();`);
      ok = true; why = (why ? why + "; " : "") + "text set by API";
    }
    S.cards.a = uid;
  }
  if (!typed && !why) why = "nothing typed";
  return finish(sum, { ok: ok && typed, why, uid, ledgered: made, keys: dist(evAll(sum, "keydown", "pxd-item", 13)) }, evd(sum, "dblclick"), sent);
}

async function moveCard(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const a = S.cards.a; if (!a) return { skip: "no card A (add-card did not make one)" };
  const r0 = await rectNow(ctx, a); if (!r0) return { skip: "card A is not on the board" };
  const z = await zoomNow(ctx);
  await look(ctx, r0.x + r0.w / 2 + 130, r0.y + r0.h / 2);
  const p = await page(ctx, `cardPoint(${J(a)})`);
  if (!p) return { skip: "card A has no safe point on its own surface" };
  const want = (t) => t.kind === "item" && t.uid === a && t.plain;
  if (!(await hoverGuard(ctx, p, want))) return { skip: "the point is not card A's own surface once hovered" };
  const before = await itemNow(ctx, a);
  const d = { x: 260, y: 40 };
  let sent = false;
  const sum = await estep(ctx, "move-card", async () => {
    if (!(await pressGuard(ctx, p, want))) return;
    sent = true;
    await ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x + d.x, y2: p.y + d.y, steps: 22, delay: 16 });
  });
  const zz = await zoomNow(ctx), r1 = await rectNow(ctx, a), after = await itemNow(ctx, a);
  const moved = r1 && r0 ? { dx: Math.round(r1.x - r0.x), dy: Math.round(r1.y - r0.y) } : null;
  const ok = sent && !!moved && near(moved.dx, d.x / zz, 40) && near(moved.dy, d.y / zz, 40) && !!after && after.parentUid === S.section;
  return finish(sum, { ok, why: ok ? null : sent ? "card did not move as expected or left the scratch section" : "guard failed", moved, expected: { dx: Math.round(d.x / zz), dy: Math.round(d.y / zz) }, parent: after && after.parentUid, release: evd(sum, "pointerup"), fmax: sum.frames?.max ?? null, row: row(sum), zoom: z }, evd(sum, "pointerdown"), sent);
}

async function resizeCard(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const a = S.cards.a; if (!a) return { skip: "no card A" };
  const r0 = await rectNow(ctx, a); if (!r0) return { skip: "card A is not on the board" };
  await look(ctx, r0.x + r0.w / 2 + 100, r0.y + r0.h / 2);
  const p = await page(ctx, `cardPoint(${J(a)})`);
  const own = (t) => t.kind === "item" && t.uid === a && t.plain;
  if (!p || !(await hoverGuard(ctx, p, own))) return { skip: "no safe point on card A to select it" };
  await hold(ctx, p.x, p.y);
  await sleep(150);
  const g = await page(ctx, `handle(${J(a)}, '.pxd-grip[data-part="corner"]')`);
  if (!g) return { skip: "no displayed corner grip on card A" };
  const isGrip = (t) => t.kind === "grip" && t.uid === a && t.part === "corner";
  if (!(await hoverGuard(ctx, g, isGrip))) return { skip: "the corner grip point is not the grip of card A" };
  const d = { x: 90, y: 60 };
  let sent = false;
  const sum = await estep(ctx, "resize-card", async () => {
    if (!(await pressGuard(ctx, g, isGrip))) return;
    sent = true;
    await ctx.input.drag({ x1: g.x, y1: g.y, x2: g.x + d.x, y2: g.y + d.y, steps: 14, delay: 16 });
  });
  const r1 = await rectNow(ctx, a);
  const grew = r1 ? { w: Math.round(r1.w - r0.w), h: Math.round(r1.h - r0.h) } : null;
  const ok = sent && !!grew && grew.w >= 20 && grew.h >= 20;
  return finish(sum, { ok, why: ok ? null : sent ? "card did not grow" : "guard failed", grew, release: evd(sum, "pointerup") }, evd(sum, "pointerdown"), sent);
}

async function connect(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const a = S.cards.a; if (!a) return { skip: "no card A" };
  const ra = await rectNow(ctx, a); if (!ra) return { skip: "card A is not on the board" };
  // card B to the right of A (the work order's x 640 unless A grew past it)
  const bx = Math.max(S.origin.x + 640, ra.x + ra.w + 160), by = ra.y;
  await ctx.writes(2);
  const bUid = await sess(ctx, `const u = await s.createCard({ x: ${bx}, y: ${by}, string: ${J(MARK + " b")} }); await s.idle(); return u;`);
  if (!bUid) return { skip: "card B was not created" };
  await ledger(bUid, "card");
  S.cards.b = bUid;
  await look(ctx, (ra.x + bx) / 2 + 130, by + 30);
  await ctx.probe.quiet({ gap: 800, max: 8000 });
  const ownB = (t) => t.kind === "item" && t.uid === bUid && t.plain;
  const ownA = (t) => t.kind === "item" && t.uid === a && t.plain;
  const endP = await page(ctx, `cardPoint(${J(bUid)})`);
  if (!endP || !(await hoverGuard(ctx, endP, ownB))) return { extra: { ok: false, why: "no verified end point on card B", via: null } };
  const startP = await page(ctx, `cardPoint(${J(a)})`);
  let port = null, viaDrag = false, sum = null, sent = false;
  if (startP && (await hoverGuard(ctx, startP, ownA, 150))) {
    port = await page(ctx, `handle(${J(a)}, '.pxd-port[data-side="right"]')`);
  }
  const isPort = (t) => t.kind === "port" && t.uid === a && t.side === "right";
  if (port && (await hoverGuard(ctx, port, isPort))) {
    sum = await estep(ctx, "connect", async () => {
      if (!(await pressGuard(ctx, port, isPort))) return;
      sent = true;
      await ctx.input.drag({ x1: port.x, y1: port.y, x2: endP.x, y2: endP.y, steps: 20, delay: 16, hold: 80 });
    });
    viaDrag = sent;
  }
  const findEdge = async () => { const snap = await readSnap(ctx); return [...snap.edges.values()].filter((e) => !S.before.edges.has(e.uid) && !S.ledger.includes(e.uid) && e.from === a && e.to === bUid); };
  let edges = viaDrag ? await findEdge() : [];
  let via = "drag";
  if (edges.length !== 1) {
    if (edges.length > 1) { for (const e of edges) await ledger(e.uid, "edge"); return finish(sum, { ok: false, why: `${edges.length} edges A -> B appeared` }, evd(sum, "pointerdown"), sent); }
    await ctx.writes(2);
    const eu = await sess(ctx, `const u = await s.addEdge({ from: ${J(a)}, to: ${J(bUid)}, label: "" }); await s.idle(); return u;`);
    if (eu) await ledger(eu, "edge");
    via = "api";
    edges = eu ? [{ uid: eu }] : [];
  } else await ledger(edges[0].uid, "edge");
  const edge = edges.length === 1 ? edges[0].uid : null;
  S.edge = edge ? { uid: edge, from: a, to: bUid } : null;
  const out = { ok: !!edge, why: edge ? null : "no edge A -> B", via, edge, b: bUid };
  if (sum) return finish(sum, out, evd(sum, "pointerdown"), sent);
  return { extra: { ...out, why: out.why || "no port on card A; edge made by API" }, ttnp: null };
}

async function undoRedo(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  if (!S.edge) return { skip: "no edge from connect" };
  const e0 = S.edge;
  const b = await rectNow(ctx, S.cards.a);
  if (b) await look(ctx, b.x + b.w + 80, b.y + 30);
  const p = await emptyScratchPoint(ctx);
  if (!p) return { skip: "no empty in-scratch point" };
  if (await page(ctx, "editing()") || await page(ctx, "fieldFocused()")) return { skip: "a text field has focus" };
  const hasEdge = async () => { const snap = await readSnap(ctx); return [...snap.edges.values()].find((e) => e.from === e0.from && e.to === e0.to) || null; };
  const s1 = await estep(ctx, "undo", async () => { await ctx.input.key("z", { mods: ["meta"] }); });
  let back = null, why = null;
  const gone = !(await hasEdge());
  if (!gone) {
    why = "undo did not remove the edge (it undid something else); redone once";
    await ctx.input.key("z", { mods: ["meta", "shift"] });
    await sleep(800);
    return finish(s1, { ok: false, why, undo: row(s1) }, evd(s1, "keydown"));
  }
  const s2 = await estep(ctx, "redo", async () => { await ctx.input.key("z", { mods: ["meta", "shift"] }); });
  back = await hasEdge();
  if (back) { S.edge = { uid: back.uid, from: back.from, to: back.to }; if (!S.ledger.includes(back.uid)) await ledger(back.uid, "edge"); } else why = "redo did not bring the edge back";
  const sum = merge("undo-redo", [s1, s2]);
  return { summary: sum, ttnp: med([evd(s1, "keydown") ?? FAST, evd(s2, "keydown") ?? FAST]), extra: { undo: row(s1), redo: row(s2), ok: gone && !!back, why, tail: tailOf([s1, s2]) } };
}

async function deleteCard(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const bUid = S.cards.b; if (!bUid) return { skip: "no card B" };
  const rb = await rectNow(ctx, bUid); if (!rb) return { skip: "card B is not on the board" };
  await look(ctx, rb.x + rb.w / 2, rb.y + rb.h / 2);
  const p = await page(ctx, `cardPoint(${J(bUid)})`);
  const ownB = (t) => t.kind === "item" && t.uid === bUid && t.plain;
  if (!p) return { skip: "no safe point on card B" };
  await clearSel(ctx);
  if (!(await hoverGuard(ctx, p, ownB))) return { skip: "no verified point on card B" };
  await hold(ctx, p.x, p.y);
  await sleep(250);
  const sel = await selNow(ctx);
  const snap = await readSnap(ctx);
  if (!(sel.length === 1 && sel[0] === bUid && mineIn(snap, bUid))) {
    await clearSel(ctx);
    return { extra: { ok: false, why: `selection is not exactly card B (${sel.length} selected)`, selected: sel.slice(0, 5) }, ttnp: null };
  }
  if (await page(ctx, "fieldFocused()")) { await clearSel(ctx); return { extra: { ok: false, why: "a text field has focus" }, ttnp: null }; }
  const sum = await estep(ctx, "delete-card", async () => { await ctx.input.key("Delete"); });
  const after = await readSnap(ctx);
  const edgeGone = !S.edge || ![...after.edges.values()].some((e) => e.from === S.edge.from && e.to === S.edge.to);
  const ok = !after.items.has(bUid) && edgeGone;
  if (ok) { S.cards.b = null; S.edge = null; }
  return finish(sum, { ok, why: ok ? null : after.items.has(bUid) ? "card B is still there" : "its edge is still there" }, evd(sum, "keydown"));
}

async function paste20(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const c = WO(200, 520);
  await look(ctx, c.x + 300, c.y + 150);
  const p = await page(ctx, `pt(${c.x}, ${c.y})`);
  if (!p || !(await inScr(ctx, p))) return { skip: "the paste point is not clear scratch background" };
  await ctx.input.move(p.x, p.y);
  await sleep(150);
  if (!(await pressGuard(ctx, p, (t) => t.kind === "empty"))) return { skip: "the paste point is not empty background" };
  const text = Array.from({ length: 20 }, (_, i) => `${MARK} paste ${String(i + 1).padStart(2, "0")}`).join("\n");
  await ctx.writes(40);
  let pasted = false;
  const sum = await estep(ctx, "paste-20", async () => {
    pasted = !!(await ctx.c.ev(`(window.__pxdStress.act(), ${E}.paste(${J(text)}))`));
  }, { wait: 800 });
  const made = await claimNew(ctx);
  const snap = await readSnap(ctx);
  const outside = made.filter((u) => !inRect(snap.items.get(u)?.rect, S.rect, 0)).length;
  return finish(sum, { ok: pasted && made.length === 20, why: !pasted ? "a text field had focus; nothing pasted" : made.length === 20 ? null : `${made.length} items appeared`, created: made.length, outside }, sum.ttnp, pasted);
}

async function apiCreate50(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const gc = WO(GRID.x + 760, GRID.y + 200);
  await look(ctx, gc.x, gc.y, 0.63);
  const cards = [];
  for (let j = 0; j < GRID.rows; j++) for (let i = 0; i < GRID.cols; i++) {
    const n = j * GRID.cols + i + 1;
    cards.push({ x: S.origin.x + GRID.x + i * (GRID.cw + GRID.gap), y: S.origin.y + GRID.y + j * (GRID.ch + GRID.gap), w: GRID.cw, h: GRID.ch, string: `${MARK} g${String(n).padStart(2, "0")}` });
  }
  const created = [];
  const sum = await estep(ctx, "api-create-50", async () => {
    await ctx.probe.act();
    for (let b = 0; b < 5; b++) {
      await ctx.writes(20);
      const uids = await sess(ctx, `const out = []; for (const c of ${J(cards.slice(b * 10, b * 10 + 10))}) out.push(await s.createCard(c)); await s.idle(); return out;`);
      for (const u of uids || []) { created.push(u); await ledger(u, "card"); }
    }
  }, { wait: 600 });
  S.grid = created.slice();
  const snap = await readSnap(ctx);
  const inSection = created.filter((u) => snap.items.get(u)?.parentUid === S.section).length;
  return finish(sum, { ok: created.length === 50 && inSection === 50, why: created.length !== 50 ? `${created.length} created` : inSection !== 50 ? `${50 - inSection} grid cards are not in the scratch section` : null, created: created.length, inSection }, sum.ttnp);
}

async function marquee(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  if (S.grid.length !== 50) return { skip: "no 50-card grid" };
  const snap = await readSnap(ctx);
  const rs = S.grid.map((u) => snap.items.get(u)?.rect);
  if (rs.some((r) => !r)) return { skip: "grid cards have no rects" };
  const gl = Math.min(...rs.map((r) => r.x)), gt = Math.min(...rs.map((r) => r.y)), gr = Math.max(...rs.map((r) => r.x + r.w)), gb = Math.max(...rs.map((r) => r.y + r.h));
  const b = await page(ctx, "box()");
  // the whole grid plus a 120 px margin on screen at zoom 0.63, or the biggest zoom that fits
  const zoom = Math.min(0.63, (b.w - 2 * 130) / (gr - gl), (b.h - 2 * 130) / (gb - gt));
  if (zoom < 0.3) return { skip: `board window too small for the grid (zoom ${zoom.toFixed(2)})` };
  await look(ctx, (gl + gr) / 2, (gt + gb) / 2, zoom);
  const p1 = await page(ctx, `pt(${gl - 60}, ${gt - 60})`), p2 = await page(ctx, `pt(${gr + 60}, ${gb + 60})`);
  if (!p1 || !p2 || !(await inScr(ctx, p1, 20)) || !(await inScr(ctx, p2, 20))) return { skip: "the selection box corners are not clear scratch background" };
  if (!(await hoverGuard(ctx, p1, (t) => t.kind === "empty"))) return { skip: "the box start is not empty background" };
  await clearSel(ctx);
  let sent = false;
  const sum = await estep(ctx, "marquee", async () => {
    if (!(await pressGuard(ctx, p1, (t) => t.kind === "empty"))) return;
    sent = true;
    await ctx.input.drag({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, steps: 24, delay: 16, mods: ["shift"] });
  });
  const sel = await selNow(ctx);
  const want = new Set(S.grid);
  const ok = sent && sel.length === 50 && sel.every((u) => want.has(u));
  return finish(sum, { ok, why: ok ? null : sent ? `selection holds ${sel.length} items, ${sel.filter((u) => want.has(u)).length} of them grid cards` : "guard failed", selected: sel.length, zoom: Math.round(zoom * 100) / 100, release: evd(sum, "pointerup"), fmax: sum.frames?.max ?? null }, evd(sum, "pointerdown"), sent);
}

async function move50(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  if (S.grid.length !== 50) return { skip: "no 50-card grid" };
  const sel = await selNow(ctx);
  const snap = await readSnap(ctx);
  const foreign = sel.filter((u) => !mineIn(snap, u));
  if (sel.length < 50 || foreign.length) {
    await clearSel(ctx);
    return { extra: { ok: false, why: foreign.length ? `selection holds ${foreign.length} items that are not ours` : `only ${sel.length} selected`, foreign: foreign.slice(0, 5) }, ttnp: null };
  }
  const gridSet = new Set(S.grid);
  const r0 = new Map(S.grid.map((u) => [u, snap.items.get(u)?.rect]));
  // zoom 1 so a card is big enough for a safe point; the other cards stay selected off screen
  let picked = null, p = null;
  for (const u of S.grid.slice(0, 5)) {
    const r = r0.get(u); if (!r) continue;
    await look(ctx, r.x + r.w / 2, r.y + r.h / 2, 1);
    const q = await page(ctx, `cardPoint(${J(u)})`);
    if (q && (await hoverGuard(ctx, q, (t) => t.kind === "item" && t.uid === u && t.plain))) { picked = u; p = q; break; }
  }
  if (!picked) { await clearSel(ctx); return { skip: "no verified point on any of the first 5 grid cards" }; }
  const sel2 = await selNow(ctx);
  if (sel2.length !== 50 || !sel2.every((u) => gridSet.has(u))) { await clearSel(ctx); return { extra: { ok: false, why: `selection changed to ${sel2.length} items before the drag` }, ttnp: null }; }
  const z = await zoomNow(ctx);
  const dy = 170;
  let sent = false;
  const sum = await estep(ctx, "move-50", async () => {
    if (!(await pressGuard(ctx, p, (t) => t.kind === "item" && t.uid === picked && t.plain))) return;
    sent = true;
    await ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y + dy, steps: 24, delay: 16 });
  });
  const after = await readSnap(ctx);
  const want = dy / z;
  const moved = S.grid.filter((u) => { const a = r0.get(u), b = after.items.get(u)?.rect; return a && b && near(b.y - a.y, want, 40) && near(b.x - a.x, 0, 12); }).length;
  return finish(sum, { ok: sent && moved === 50, why: sent ? (moved === 50 ? null : `${moved} of 50 moved by about ${Math.round(want)}`) : "guard failed", moved, expectedDy: Math.round(want), zoom: z, release: evd(sum, "pointerup"), fmax: sum.frames?.max ?? null, row: row(sum) }, evd(sum, "pointerdown"), sent);
}

async function moveSection(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const sr = await rectNow(ctx, S.section);
  await look(ctx, sr.x + 500, sr.y + 60);
  if (!(await clearSel(ctx))) return { skip: "selection could not be cleared" };
  const p = await page(ctx, `titlePoint(${J(S.section)})`);
  const isTitle = (t) => t.kind === "section-title" && t.uid === S.section;
  if (!p || !(await hoverGuard(ctx, p, isTitle))) return { skip: "no verified point on the scratch section's title" };
  const z = await zoomNow(ctx);
  const memberUid = S.cards.a || S.grid[0] || null;
  const m0 = memberUid ? await rectNow(ctx, memberUid) : null;
  const d = { x: 200, y: 120 };
  let sent = false;
  const sum = await estep(ctx, "move-section", async () => {
    if (!(await pressGuard(ctx, p, isTitle))) return;
    sent = true;
    await ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x + d.x, y2: p.y + d.y, steps: 24, delay: 16 });
  });
  const r1 = await rectNow(ctx, S.section), m1 = memberUid ? await rectNow(ctx, memberUid) : null;
  const dx = r1 ? r1.x - sr.x : null, dyy = r1 ? r1.y - sr.y : null;
  const ok = sent && r1 != null && near(dx, d.x / z, 40) && near(dyy, d.y / z, 40) && (!m0 || (m1 && near(m1.x - m0.x, dx, 20) && near(m1.y - m0.y, dyy, 20)));
  if (r1 && sent && dx != null) {
    // follow the section wherever it ended up so later guards use the real place
    S.origin = { x: S.origin.x + dx, y: S.origin.y + dyy };
    S.rect = { ...S.rect, x: S.rect.x + dx, y: S.rect.y + dyy };
  }
  return finish(sum, { ok, why: ok ? null : sent ? "section or its member did not move as expected" : "guard failed", moved: { dx: dx == null ? null : Math.round(dx), dy: dyy == null ? null : Math.round(dyy) }, release: evd(sum, "pointerup"), fmax: sum.frames?.max ?? null }, evd(sum, "pointerdown"), sent);
}

async function selectAll(ctx) {
  const why0 = await gate(ctx); if (why0) return { skip: why0 };
  const sr = await rectNow(ctx, S.section);
  await look(ctx, sr.x + 500, sr.y + 300);
  await clearSel(ctx);
  const p = await emptyScratchPoint(ctx);
  if (!p) return { skip: "no empty in-scratch point" };
  if ((await page(ctx, "editing()")) || (await page(ctx, "fieldFocused()"))) return { skip: "a text field has focus" };
  let selected = null;
  // Cmd+A selects every item of the board, real ones included. The only key sent while it is selected is Escape.
  const sum = await estep(ctx, "select-all", async () => {
    try {
      await ctx.input.key("a", { mods: ["meta"] });
      await sleep(600);
      selected = (await selNow(ctx)).length;
    } finally {
      await ctx.input.key("Escape");
    }
  }, { wait: 200 });
  await sleep(200);
  if ((await selNow(ctx)).length) {
    const q = await emptyScratchPoint(ctx);
    if (q) { await hold(ctx, q.x, q.y); await sleep(300); }
    if ((await selNow(ctx)).length) throw new Error("selection could not be cleared");
  }
  return finish(sum, { ok: true, selected }, evd(sum, "keydown"));
}

// delete the scratch section with everything in it, after checking that nothing in it existed before the run
async function deleteScratch(ctx, { around = null } = {}) {
  const snap = await readSnap(ctx);
  if (S.before.items.has(S.section)) throw new Error(`refusing: the scratch section ${S.section} existed before the run`);
  let ran = false;
  if (snap.items.has(S.section)) {
    const desc = descendantsOf(snap, S.section);
    for (const d of desc) if (S.before.items.has(d)) throw new Error(`refusing to delete the scratch section: ${d} inside it existed before the run`);
    const set = new Set([S.section, ...desc]);
    for (const e of snap.edges.values()) if (set.has(e.from) !== set.has(e.to)) throw new Error(`refusing: edge ${e.uid} joins the scratch section to an item outside it`);
    for (const d of desc) await ledger(d, "item");
    await ctx.writes(desc.length * 2 + 6);
    const del = async () => { await sess(ctx, `await s.deleteItems(${J([S.section])}, { withContents: true, force: true }); await s.idle();`); };
    if (around) await around(del); else await del();
    ran = true;
  }
  if (!around) await sleep(800);
  let clean = null;
  for (let i = 0; i < 4; i++) { clean = await verifyClean(ctx); if (clean.clean) break; await sleep(1000); }
  if (!clean.clean) { await cleanupAll(ctx); clean = await verifyClean(ctx); }
  return { clean, ran, removed: S.ledger.length };
}
async function buildCleanup(ctx) {
  await install(ctx);
  if (!S.section || !S.before) return { skip: "no scratch section to clean up" };
  const sr = await rectNow(ctx, S.section);
  if (sr) await look(ctx, sr.x + 500, sr.y + 300, 0.5);
  let sum = null, res = null;
  res = await deleteScratch(ctx, {
    around: async (del) => { sum = await estep(ctx, "delete-section", async () => { await ctx.probe.act(); await del(); }, { wait: 600 }); },
  });
  const out = { ok: res.clean.clean, why: res.clean.clean ? null : "board is not back to its state before the run", clean: res.clean, ledgered: S.ledger.length };
  S = newS();
  return sum ? finish(sum, out, sum.ttnp) : { extra: out, ttnp: null };
}

// ---- typing
const TYPED = "the quick brown fox jumps over the lazy dog while the slow green turtle walks past the old stone wall near the quiet river bank and the farmer counts sheep in the long field until the sun goes down behind the hills";
const text200 = () => (" " + TYPED).slice(0, 200);
async function typeCard(ctx) {
  await install(ctx);
  await ensureScratch(ctx, { selfClean: true });
  let result;
  try {
    const at = WO(760, 900);
    await look(ctx, at.x + 300, at.y + 100);
    await ctx.writes(2);
    const uid = await sess(ctx, `const u = await s.createCard({ x: ${at.x}, y: ${at.y}, string: ${J(MARK + " type")} }); await s.idle(); return u;`);
    if (!uid) throw new Error("typing card was not created");
    await ledger(uid, "card");
    await ctx.probe.quiet({ gap: 800, max: 8000 });
    const p = await page(ctx, `cardPoint(${J(uid)})`);
    const own = (t) => t.kind === "item" && t.uid === uid && t.plain;
    if (!p || !(await hoverGuard(ctx, p, own))) result = { extra: { ok: false, why: "no verified point on the typing card" }, ttnp: null };
    else {
      await ctx.input.dblclick(p.x, p.y);
      let ed = "";
      for (let i = 0; i < 30 && ed !== uid; i++) { await sleep(100); ed = await page(ctx, "editing()"); }
      if (ed !== uid) {
        await ctx.input.key("Escape");
        result = { extra: { ok: false, why: "the editor of the typing card did not open" }, ttnp: null };
      } else {
        await page(ctx, `caretEnd(${J(uid)})`);
        await ctx.c.ev(`(window.__pxdStress.view().typingProfile({ reset: true }), 1)`);
        const text = text200();
        const sum = await estep(ctx, "type-card", async () => {
          if ((await page(ctx, "editing()")) !== uid) return;
          await ctx.input.type(text, { interval: 80 });
          await ctx.input.key("Escape");
        }, { wait: 600 });
        const prof = await ctx.c.evJson(`JSON.stringify(window.__pxdStress.view().typingProfile())`);
        const typing = prof && !prof.armed ? { sinceMs: prof.sinceMs, keys: prof.keys, key: prof.key, frames: prof.frames, scripts: (prof.scripts || []).slice(0, 6) } : prof;
        const keys = dist(evAll(sum, "keydown", "pxd-item", 200));
        const typed = await page(ctx, `stringOf(${J(uid)})`);
        result = finish(sum, { ok: typeof typed === "string" && typed.length >= MARK.length + 150, why: null, typing, keys, typedLength: typeof typed === "string" ? typed.length : null }, keys.p90);
        if (!result.extra.ok) result.extra.why = "the card did not receive the typed text";
      }
    }
  } finally {
    if (S.selfClean) {
      try { const r = await deleteScratch(ctx); if (result) result.extra = { ...result.extra, clean: r.clean }; S = newS(); } catch (e) { if (result) result.extra = { ...result.extra, cleanErr: String(e.message || e).slice(0, 300) }; else throw e; }
    }
  }
  return result;
}

async function revealBoard(ctx) {
  if (ctx.revealBoard) await ctx.revealBoard(); else { await page(ctx, "reveal()"); }
  await sleep(300);
}
async function typeBlock(ctx) {
  await install(ctx);
  const wasFs = await ctx.fsState();
  let uid = null, result = null, err = null, gone = null;
  try {
    if (wasFs) await ctx.fullscreen(false);
    await install(ctx);
    const inView = await page(ctx, "boardInView()");
    const info = await ctx.probe.info().catch(() => null);
    const ctxInfo = { boardInView: inView, attached: info ? info.attached : null };
    uid = await roam(ctx, "window.roamAlphaAPI.util.generateUID()");
    S.run = S.run || "e" + Date.now().toString(36);
    await ledger(uid, "block"); // recorded before it exists, so a crash still finds it
    await ctx.writes(2);
    await roam(ctx, `window.roamAlphaAPI.data.block.create({ location: { "parent-uid": ${J(PAGE)}, order: "last" }, block: { uid: ${J(uid)}, string: ${J(MARK + " typing block")} } })`);
    let p = null;
    for (let i = 0; i < 30 && !p; i++) { await sleep(100); p = await page(ctx, `blockPoint(${J(uid)})`); }
    if (!p) result = { extra: { ok: false, why: "the new block has no clickable place on the page", ...ctxInfo }, ttnp: null };
    else {
      await sleep(300);
      p = await page(ctx, `blockPoint(${J(uid)})`);
      if (!p) result = { extra: { ok: false, why: "the block lost its clickable place", ...ctxInfo }, ttnp: null };
      else {
        await hold(ctx, p.x, p.y);
        let f = false;
        for (let i = 0; i < 20 && !f; i++) { await sleep(100); f = await page(ctx, `focusedBlock(${J(uid)})`); }
        if (!f) { await ctx.input.key("Escape"); result = { extra: { ok: false, why: "the block editor did not open", ...ctxInfo }, ttnp: null }; }
        else {
          await page(ctx, `blockCaretEnd(${J(uid)})`);
          const inView2 = await page(ctx, "boardInView()");
          const sum = await estep(ctx, "type-block", async () => {
            if (!(await page(ctx, `focusedBlock(${J(uid)})`))) return;
            await ctx.input.type(text200(), { interval: 80 });
            await ctx.input.key("Escape");
          }, { wait: 600 });
          const keys = dist(evAll(sum, "keydown", "roam-editor", 200));
          result = finish(sum, { ok: true, keys, ...ctxInfo, boardInView: inView2 }, keys.p90);
        }
      }
    }
  } catch (e) {
    err = e;
  }
  // 1. the typed block goes first and does not depend on anything below
  if (uid) {
    try {
      await ctx.input.key("Escape");
      await ctx.writes(2);
      await roam(ctx, `window.roamAlphaAPI.data.block.delete({ block: { uid: ${J(uid)} } })`);
      gone = false;
      for (let i = 0; i < 20 && !gone; i++) { gone = (await existing(ctx, [uid])).length === 0; if (!gone) await sleep(150); }
    } catch (e) { err = err || e; }
  }
  // 2. board back on screen, then fullscreen again
  let restored = true, restoreWhy = null;
  try {
    await install(ctx);
    await revealBoard(ctx);
    if (wasFs) await ctx.fullscreen(true);
    await install(ctx);
  } catch (e) { restored = false; restoreWhy = String(e.message || e).slice(0, 200); }
  if (result) {
    result.extra = { ...result.extra, blockDeleted: gone, fullscreenRestored: restored, ...(restoreWhy ? { fullscreenWhy: restoreWhy } : {}) };
    if (gone === false) result.extra.ok = false;
  }
  if (err && !result) throw err;
  if (err) result.extra.err = String(err.message || err).slice(0, 200);
  return result;
}

async function searchType(ctx) {
  await install(ctx);
  if (!(await page(ctx, "box()"))) return { skip: "board view not available" };
  const p = await page(ctx, "findEmpty()");
  if (!p) return { skip: "no empty background for the pointer" };
  if (!(await hoverGuard(ctx, p, (t) => t.kind === "empty"))) return { skip: "the pointer point is not empty background" };
  if (await page(ctx, "fieldFocused()")) return { skip: "a text field has focus" };
  await ctx.input.key("/", { code: "Slash", vk: 191 });
  let open = false;
  for (let i = 0; i < 20 && !open; i++) { await sleep(100); open = await page(ctx, "searchInputFocused()"); }
  if (!open) { await ctx.input.key("Escape"); return { extra: { ok: false, why: "Find on board did not open within 2 s" }, ttnp: null }; }
  const sum = await estep(ctx, "search-type", async () => {
    if (!(await page(ctx, "searchInputFocused()"))) return;
    await ctx.input.type("cronobacter spore control", { interval: 90 });
    for (let i = 0; i < 3; i++) {
      await ctx.input.key("Escape");
      await sleep(200);
      if (!(await page(ctx, "searchFocused()"))) break;
    }
  }, { wait: 400 });
  const closed = !(await page(ctx, "searchFocused()"));
  if (!closed) await ctx.input.key("Escape");
  const keys = dist(evAll(sum, "keydown", "pxd-root", 25));
  return finish(sum, { ok: closed, closed, why: closed ? null : "search kept focus after three Escapes", keys }, keys.p90);
}

// ---- soak step (exported): API only, no pointer, no camera move
let soakN = 0, soakPrev = null;
export async function soakEdit(ctx) {
  let uid = null, step = "start";
  try {
    await install(ctx);
    const existed = !!(S.section && (await onBoard(ctx, S.section)));
    const vp = existed ? null : await ctx.c.evJson(`JSON.stringify((${ctx.view}).viewport())`);
    step = "ensureScratch";
    await ensureScratch(ctx);
    if (!existed && vp) { await ctx.show(vp); await install(ctx); }
    const n = soakN++;
    const slot = n % 96;
    const x = S.origin.x + 160 + (slot % 12) * 150, y = S.origin.y + 1500 + Math.floor(slot / 12) * 80;
    await ctx.writes(4);
    step = "create";
    uid = await sess(ctx, `const u = await s.createCard({ x: ${x}, y: ${y}, w: 130, h: 60, string: ${J(`${MARK} soak ${n}`)} }); await s.idle(); return u;`);
    if (uid) await ledger(uid, "card");
    step = "move";
    if (uid) await sess(ctx, `await s.commitMove([${J(uid)}], 30, 20); await s.idle();`);
    step = "delete previous";
    let deleted = 0;
    if (soakPrev) {
      const snap = await readSnap(ctx);
      if (snap.items.has(soakPrev) && S.ledger.includes(soakPrev) && !S.before.items.has(soakPrev)) {
        await ctx.writes(4);
        await sess(ctx, `await s.deleteItems(${J([soakPrev])}, { withContents: true, force: true }); await s.idle();`);
        deleted = 1;
      }
    }
    soakPrev = uid || null;
    const snap2 = await readSnap(ctx);
    return { created: uid ? 1 : 0, deleted, items: descendantsOf(snap2, S.section).length };
  } catch (e) {
    if (uid) soakPrev = uid; // made and ledgered: the next call removes it
    return { error: `${step}: ${String((e && e.message) || e).slice(0, 300)}`, created: uid ? 1 : 0 };
  }
}

export const scenarios = [
  { name: "build-setup", title: "Create the scratch section (PXD-BENCH, far right of the board)", needs: "board", run: buildSetup },
  { name: "add-card", title: "Double-click empty scratch background, type a card", needs: "board", run: addCard },
  { name: "move-card", title: "Drag the new card 260 px", needs: "board", run: moveCard },
  { name: "resize-card", title: "Drag the card's corner grip", needs: "board", run: resizeCard },
  { name: "connect", title: "Drag from the card's right port to a second card", needs: "board", run: connect },
  { name: "undo-redo", title: "Cmd+Z then Cmd+Shift+Z on the connection", needs: "board", run: undoRedo },
  { name: "delete-card", title: "Select the second card and press Delete", needs: "board", run: deleteCard },
  { name: "paste-20", title: "Paste 20 lines of text onto the board", needs: "board", run: paste20 },
  { name: "api-create-50", title: "Create a 10 x 5 grid of 50 cards by API", needs: "board", run: apiCreate50 },
  { name: "marquee", title: "Shift+drag a selection box around the grid", needs: "board", run: marquee },
  { name: "move-50", title: "Drag the 50 selected cards down", needs: "board", run: move50 },
  { name: "move-section", title: "Drag the scratch section by its title", needs: "board", run: moveSection },
  { name: "select-all", title: "Cmd+A then Escape", needs: "board", run: selectAll },
  { name: "build-cleanup", title: "Delete the scratch section and prove the board is as it was", needs: "board", run: buildCleanup },
  { name: "type-card", group: "type", title: "Type 200 characters into a card on the scratch section", needs: "board", run: typeCard },
  { name: "type-block", group: "type", title: "Type 200 characters into a plain Roam block with the board mounted", needs: "board", run: typeBlock },
  { name: "search-type", group: "type", title: "Type a search into Find on board", needs: "board", run: searchType },
];
