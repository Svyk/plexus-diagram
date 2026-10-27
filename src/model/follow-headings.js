// PXD-14 follow a page by headings. The page's top-level H1-H3 blocks become sections of the board, and the blocks
// directly under a heading become ref cards inside its section. Pure helpers: the heading read, which placed cards
// moved to another heading in the source, and the layout of Place / Place all. Nothing here touches Roam.

import { FOLLOW_READ_CAP, sourceText } from "./follow.js";
import { clearRight, withTitle } from "./linked-cards.js";
import { plainText } from "./schema.js";

// Plexus key. On a section: the heading uid it stands for. On a card: the heading uid it was under when placed.
export const FOLLOW_HEAD = "head";

export const headingsNote = "Sections are the page's top-level H1–H3 headings. Each block directly under a heading becomes a card in its section.";
export const headingsEmpty = "This page has no top-level H1–H3 headings yet.";

const UID = ":block/uid";
const STR = ":block/string";
const ORD = ":block/order";
const KIDS = ":block/children";
const HEAD = ":block/heading";
// Better Tasks keeps its attributes as child blocks; they are not items.
const META = /^BT_attr[\w-]*::/;

const PAD = 32;
const GAP = 24;
const STACK_GAP = 24;
const SECTION_GAP = 64;
const COLUMN_MAX = 8;
const TITLE_MAX = 80;

const timeOf = (node) => Math.max(Number(node?.[":create/time"]) || 0, Number(node?.[":edit/time"]) || 0);
const sorted = (node) => (Array.isArray(node?.[KIDS]) ? node[KIDS].slice().sort((a, b) => (a?.[ORD] ?? 0) - (b?.[ORD] ?? 0)) : []);

// Outline order, at most `cap` items: each top-level H1-H3 block, then its children. `skip` drops a block (a heading
// takes its children with it). A level with more children than the cap came back cut, so the read is partial.
export function headingItems(page, { cap = FOLLOW_READ_CAP, skip = new Set() } = {}) {
  const items = [];
  let complete = true;
  const top = sorted(page);
  if (top.length > cap) complete = false;
  for (const head of top) {
    const level = head?.[HEAD];
    const uid = head?.[UID];
    if (typeof uid !== "string" || !(level >= 1 && level <= 3) || skip.has(uid)) continue;
    if (items.length >= cap) { complete = false; break; }
    const text = sourceText(typeof head[STR] === "string" ? head[STR] : "");
    items.push({ uid, kind: "heading", text, time: timeOf(head), heading: uid });
    const kids = sorted(head);
    if (kids.length > cap) complete = false;
    for (const kid of kids) {
      const kidUid = kid?.[UID];
      if (typeof kidUid !== "string" || skip.has(kidUid)) continue;
      const string = typeof kid[STR] === "string" ? kid[STR] : "";
      if (META.test(string.trim())) continue;
      if (items.length >= cap) { complete = false; break; }
      items.push({ uid: kidUid, kind: "block", text: sourceText(string), time: timeOf(kid), heading: uid, headingText: text, depth: 2, ...(string.trim() ? {} : { blank: true }) });
    }
    if (!complete && items.length >= cap) break;
  }
  return { items, complete };
}

// Placed cards whose block now sits under another heading of the source: [{ uid (card), to (heading uid), toText }].
// The card stays where it is; the tray offers to take the new heading as its own.
export function movedCards(read, board, key) {
  if (!read?.ok) return [];
  const now = new Map();
  for (const item of read.items || []) if (item?.kind === "block" && item.uid) now.set(item.uid, item);
  const out = [];
  for (const card of board?.items?.values?.() || []) {
    if (card.src !== key || card.type !== "card" || typeof card.head !== "string") continue;
    const seen = now.get(card.target?.kind === "block" && card.target.uid ? card.target.uid : card.uid);
    if (seen && typeof seen.heading === "string" && seen.heading !== card.head) out.push({ uid: card.uid, to: seen.heading, toText: seen.headingText || "" });
  }
  return out;
}

// World-space plan for Place / Place all. entries: tray rows (heading rows: kind "heading", text; block rows: kind
// "block", heading, headingText). order: heading uids in source order. rects: world rects of the board's items.
// Returns ordered ops. { op: "section", head, title, x, y, w, h } at the board root, and { op: "card", uid, kind,
// title?, head, into, x, y } where `into` is an existing section's uid, or null for the section made by an earlier op.
// Cards of a heading that has a section go in one column at its left, below its lowest member (auto-fit grows it).
// A heading without a section gets one, in columns of at most COLUMN_MAX; new sections sit side by side right of the
// source's sections (or of the board), then the row moves right past anything it would cover. Nothing existing moves.
export function headingPlan({ entries = [], order = [], board, rects, key = "", size, gap = GAP } = {}) {
  const w = size?.w > 0 ? size.w : 280;
  const h = size?.h > 0 ? size.h : 160;
  const rank = new Map((order || []).map((uid, i) => [uid, i]));
  const byHead = new Map();
  const bucket = (head) => {
    if (!byHead.has(head)) byHead.set(head, { head, title: "", blocks: [] });
    return byHead.get(head);
  };
  for (const e of entries || []) {
    const head = e?.heading;
    if (typeof head !== "string" || !rank.has(head)) continue;
    const b = bucket(head);
    if (e.kind === "heading") b.title = e.text;
    else {
      if (!b.title) b.title = e.headingText || "";
      b.blocks.push(e);
    }
  }
  const sections = new Map();
  for (const item of board?.items?.values?.() || []) {
    if (item.type === "section" && item.src === key && typeof item.head === "string" && !sections.has(item.head)) sections.set(item.head, item);
  }
  const heads = [...byHead.values()].sort((a, b) => rank.get(a.head) - rank.get(b.head));
  const mine = [...sections.values()].map((s) => rects?.get(s.uid)).filter(Boolean);
  const roots = (board?.roots || []).map((uid) => rects?.get(uid)).filter(Boolean);
  const row = mine.length ? mine : roots;
  const x0 = row.length ? Math.max(...row.map((r) => r.x + r.w)) + SECTION_GAP : 0;
  const y0 = row.length ? Math.min(...row.map((r) => r.y)) : 0;

  // New sections first (their positions need the row shift), then the ops in heading order.
  const fresh = [];
  let x = x0;
  for (const b of heads) {
    if (sections.has(b.head)) continue;
    const n = b.blocks.length;
    const cols = Math.max(1, Math.ceil(n / COLUMN_MAX));
    const rows = Math.max(1, Math.min(n, COLUMN_MAX));
    const sw = PAD * 2 + cols * w + (cols - 1) * gap;
    const sh = PAD * 2 + rows * h + (rows - 1) * STACK_GAP;
    fresh.push({ b, x, y: y0, w: sw, h: sh });
    x += sw + SECTION_GAP;
  }
  let dx = 0;
  if (fresh.length) {
    const left = fresh[0].x;
    const box = { x: left, y: y0, w: x - SECTION_GAP - left, h: Math.max(...fresh.map((f) => f.h)) };
    const avoid = [];
    for (const item of board?.items?.values?.() || []) {
      const r = rects?.get(item.uid);
      if (r) avoid.push(item.type === "section" ? withTitle(r) : r);
    }
    dx = clearRight(withTitle(box), avoid);
  }
  const place = new Map(fresh.map((f) => [f.b.head, f]));

  const ops = [];
  for (const b of heads) {
    const own = sections.get(b.head);
    if (own) {
      const r = rects?.get(own.uid);
      if (!r) continue;
      const bottoms = (own.members || []).map((uid) => rects.get(uid)).filter(Boolean).map((m) => m.y + m.h);
      let y = bottoms.length ? Math.max(...bottoms) + STACK_GAP : r.y + PAD;
      for (const e of b.blocks) {
        ops.push(cardOp(e, b.head, own.uid, r.x + PAD, y));
        y += h + STACK_GAP;
      }
      continue;
    }
    const f = place.get(b.head);
    ops.push({ op: "section", head: b.head, title: plainText(b.title, TITLE_MAX) || "Untitled", x: f.x + dx, y: f.y, w: f.w, h: f.h });
    b.blocks.forEach((e, i) => {
      ops.push(cardOp(e, b.head, null, f.x + dx + PAD + Math.floor(i / COLUMN_MAX) * (w + gap), f.y + PAD + (i % COLUMN_MAX) * (h + STACK_GAP)));
    });
  }
  return ops;
}

const cardOp = (e, head, into, x, y) => ({ op: "card", uid: e.uid, kind: e.kind, ...(e.title ? { title: e.title } : {}), head, into, x, y });
