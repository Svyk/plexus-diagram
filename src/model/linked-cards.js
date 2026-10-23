// "Add linked references as cards": every block that references a card's page or block becomes a ref card
// beside it, flat or one section per page the references sit on. Positions are world coordinates.

export const LINKED_CARD_MODES = ["flat", "page"];
const CARD = { w: 280, h: 160 };
const GAP = 24;
const BESIDE = 80;
// Above FIT_PAD, so auto-fit has nothing to grow. Section titles render above the frame.
const PAD = 32;
const SECTION_GAP = 64;
const REF_UID = /^[\w-]+$/;

// Host rows [uid, pageTitle] → { uid, pageTitle }, once per block. The block itself and blocks on the
// page itself are not linked references (Roam leaves them out too).
export function linkedRefRows(rows, { selfUid = "", selfTitle = "" } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const uid = row?.[0];
    const pageTitle = typeof row?.[1] === "string" ? row[1] : "";
    if (typeof uid !== "string" || !uid || seen.has(uid)) continue;
    if (selfUid && uid === selfUid) continue;
    if (selfTitle && pageTitle === selfTitle) continue;
    seen.add(uid);
    out.push({ uid, pageTitle });
  }
  return out;
}

// One group per page, most references first, then by title. Inside a group the host order is kept.
export function groupLinkedRefs(refs, { skip } = {}) {
  const skipSet = skip instanceof Set ? skip : new Set(skip || []);
  const groups = new Map();
  const seen = new Set();
  for (const ref of refs || []) {
    const uid = ref?.uid;
    if (typeof uid !== "string" || !REF_UID.test(uid) || seen.has(uid) || skipSet.has(uid)) continue;
    seen.add(uid);
    const title = String(ref.pageTitle ?? "").trim();
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(uid);
  }
  return [...groups.entries()]
    .map(([title, uids]) => ({ title, uids }))
    .sort((a, b) => b.uids.length - a.uids.length || a.title.localeCompare(b.title));
}

const gridOf = (n) => {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
};

// The cards go right of `rect` in a grid. In "page" mode each group is a section sized to its card grid, and the
// sections are rows of a grid themselves. A section is one change and holds at least one card, so a group starts
// only while two changes are left in `cap`. `left` counts the references that were not added.
export function linkedCardsLayout(rect, refs, { mode = "flat", skip, cap = 22, card = CARD } = {}) {
  const groups = groupLinkedRefs(refs, { skip });
  const total = groups.reduce((n, g) => n + g.uids.length, 0);
  if (!rect || !total) return { cards: [], sections: [], added: 0, total, left: total };
  const limit = Math.max(0, Math.floor(Number(cap) || 0));
  const w = card?.w > 0 ? card.w : CARD.w;
  const h = card?.h > 0 ? card.h : CARD.h;
  const x0 = rect.x + rect.w + BESIDE;
  const y0 = rect.y;
  const at = (x, y, i, cols) => ({ x: x + (i % cols) * (w + GAP), y: y + Math.floor(i / cols) * (h + GAP) });

  if (mode !== "page") {
    const uids = groups.flatMap((g) => g.uids).slice(0, limit);
    const { cols } = gridOf(uids.length);
    const cards = uids.map((uid, i) => ({ string: `((${uid}))`, ...at(x0, y0, i, cols) }));
    return { cards, sections: [], added: cards.length, total, left: total - cards.length };
  }

  const picked = [];
  let budget = limit;
  for (const g of groups) {
    if (budget < 2) break;
    const uids = g.uids.slice(0, budget - 1);
    picked.push({ title: g.title || "Untitled", uids });
    budget -= 1 + uids.length;
  }
  const { cols: perRow } = gridOf(picked.length);
  const sections = [];
  let y = y0;
  for (let start = 0; start < picked.length; start += perRow) {
    let x = x0;
    let rowH = 0;
    for (const g of picked.slice(start, start + perRow)) {
      const { cols, rows } = gridOf(g.uids.length);
      const sw = PAD * 2 + cols * w + (cols - 1) * GAP;
      const sh = PAD * 2 + rows * h + (rows - 1) * GAP;
      const cards = g.uids.map((uid, i) => ({ string: `((${uid}))`, ...at(x + PAD, y + PAD, i, cols) }));
      sections.push({ title: g.title, x, y, w: sw, h: sh, cards });
      x += sw + SECTION_GAP;
      rowH = Math.max(rowH, sh);
    }
    y += rowH + SECTION_GAP;
  }
  const added = sections.reduce((n, s) => n + s.cards.length, 0);
  return { cards: [], sections, added, total, left: total - added };
}

export function linkedCardsMessage({ added = 0, sections = 0, left = 0 } = {}) {
  const refs = `${added} linked ${added === 1 ? "reference" : "references"}`;
  const inside = sections ? ` in ${sections} ${sections === 1 ? "section" : "sections"}` : "";
  const rest = left ? `, ${left} left out (Roam undo holds 50 changes)` : "";
  return `Added ${refs}${inside}${rest}`;
}
