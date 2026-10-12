// Blueprint -> write plan. Pure: no Roam, no files. Every stored string and prop comes from Plexus's own model
// serializers (src/model/*), so the graph holds exactly what Plexus itself writes.
//
// The plan is a list of ops in creation order (a parent always before its children, siblings in order):
//   { key, uid, kind: "page"|"block", stage, parent (uid, blocks only), title (pages), string, props, open, fallback }
// Strings may hold placeholders the builder resolves at write time:
//   ⟦HL:S001:3⟧ Roam highlight uid · ⟦IMG:K12⟧ uploaded image url · ⟦REF:K12⟧ a card's link form ([[page]] or ((uid)))
// When a placeholder cannot be resolved (highlight text not found, upload failed) the op's `fallback` string is used.
import { boardString, classifyString, dailyPageTitle, lookForNewString, serializeEdge, serializeItemLayout, SCHEMA_VERSION, BOARD_PATTERNS, PALETTE } from "../../../../src/model/schema.js";
import { CONTAINER_STRING, PIN_CONTAINER_STRING, serializeRegion } from "../../../../src/model/regions.js";
import { viewBlockString } from "../../../../src/model/view-save.js";
import { trailString } from "../../../../src/model/trails.js";
import { snapshotProps, snapshotTitle } from "../../../../src/model/snapshots.js";
import { COMMENTS_CONTAINER_STRING, commentAnchorString } from "../../../../src/model/comments.js";
import { imageRegionString } from "../../../../src/model/image-region.js";
import { TABLE_ROOT } from "../../../../src/model/roam-table.js";
import { cleanPageTitle, pageCardString } from "../../../../src/model/pdf-page.js";
import { parseHighlightRef, rootTitleOf } from "./blueprint.mjs";
import { chartRows, placeBoard } from "./layout.mjs";
import { uidFor } from "./uid.mjs";

export const MARK = "phd-stress";
export const STAGES = ["pages", "structure", "edges", "extras"];
const DUMMY_UID = "AAAAAAAAA";
const DUMMY_URL = "https://example.com/x.png";
const PH = /⟦(HL|IMG|REF):([^⟧]+)⟧/g;

const flatten = (s) => String(s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
const firstAuthorLast = (s) => {
  const a = Array.isArray(s.authors) ? s.authors[0] : "";
  return String(a || "").split(/[ ,]/)[0] || "Anon";
};

// `PhD/Library/<short>`: the source's `short`, else "<first author> <year> - <title (60)>". No "/" inside.
export function libraryTitle(source) {
  if (typeof source.pageTitle === "string" && source.pageTitle.startsWith("PhD/") && !/\[\[|\]\]/.test(source.pageTitle)) return source.pageTitle;
  const short = source.short ? cleanPageTitle(source.short, 90) : cleanPageTitle(`${firstAuthorLast(source)} ${source.year || ""} - ${source.title || source.id}`, 90);
  return `PhD/Library/${short || source.id}`;
}

// The string with placeholders swapped for valid dummies, so Plexus's classifier sees the real shape.
export function shapeOf(string) {
  return String(string ?? "").replace(PH, (_, kind) => (kind === "IMG" ? DUMMY_URL : kind === "REF" ? `((${DUMMY_UID}))` : DUMMY_UID));
}

export function placeholders(string) {
  return [...String(string ?? "").matchAll(PH)].map((m) => ({ kind: m[1], arg: m[2] }));
}

// Link form of a resolved card string: [[Title]] for page cards, ((target)) for block-ref cards, else ((cardUid)).
export function refFor(string, cardUid) {
  const cls = classifyString(string);
  if (cls.kind === "page") return `[[${cls.title}]]`;
  if (cls.kind === "block") return `((${cls.refUid}))`;
  return `((${cardUid}))`;
}

// `((K12))` / `((S001:h3))` tokens in blueprint text -> the card's block ref / a highlight placeholder.
export function textRefs(text, cardUid) {
  return String(text ?? "").replace(/\(\(([A-Za-z][\w:#-]*)\)\)/g, (m, id) => {
    const uid = cardUid(id);
    if (uid) return `((${uid}))`;
    const hl = parseHighlightRef(id);
    if (hl) return `((⟦HL:${hl.source}:${hl.index}⟧))`;
    return m;
  });
}

function ensureTodo(text) {
  const t = String(text ?? "").trim();
  return /^\{\{\[\[(TODO|DONE)\]\]\}\}/.test(t) ? t : `{{[[TODO]]}} ${t}`;
}

const tableRowsOf = (card) => {
  if (card.type === "chart") return card.table?.rows || chartRows(card.chart);
  return card.table?.rows || [];
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "October 1st, 2026" -> Date (local noon), or null.
export function parseDailyTitle(title) {
  const m = /^([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th), (\d{4})$/.exec(String(title ?? "").trim());
  if (!m || !MONTH_NAMES.includes(m[1])) return null;
  return new Date(Number(m[3]), MONTH_NAMES.indexOf(m[1]), Number(m[2]), 12);
}

// The real blueprint's extras keys (WO P1) -> the builder's own shape. Unknown keys stay for the warning pass.
export function normalizeExtras(ex = {}, library = []) {
  const out = { ...ex };
  const info = ["rootPage", "templates", "dailyPagesReferenced", "newAttributes", "newTags", "landmarks", "libraryPages"];
  for (const k of info) delete out[k];
  if (ex.libraryPages) for (const s of library) if (ex.libraryPages[s.id]) s.pageTitle = ex.libraryPages[s.id];
  const notebook = [];
  const byPage = new Map();
  for (const n of ex.notebook || []) {
    if (n.blocks) { notebook.push(n); continue; }
    if (!n.page) continue;
    const key = n.page;
    if (!byPage.has(key)) { byPage.set(key, { ...(String(n.page).startsWith("PhD/") ? { title: n.page } : { dailyTitle: n.page }), blocks: [] }); notebook.push(byPage.get(key)); }
    byPage.get(key).blocks.push({ id: n.id, text: n.text, children: n.children });
  }
  for (const d of ex.dailyInbox || []) {
    const key = `daily:${d.page}`;
    if (!byPage.has(key)) { byPage.set(key, { dailyTitle: d.page, blocks: [] }); notebook.push(byPage.get(key)); }
    byPage.get(key).blocks.push({ id: d.id, text: d.text });
  }
  delete out.dailyInbox;
  out.notebook = notebook;
  out.trails = (ex.trails || []).map((t) => ({ board: t.board, name: t.name || t.title, stops: (t.stops || []).map((st) => (typeof st === "string" ? st : { card: st.card || st.item, note: st.note })) }));
  out.views = [...(ex.views || []), ...(ex.savedViews || []).map((v) => ({ board: v.board, caption: v.caption || v.name, cards: v.cards, sections: v.sections, rect: v.rect }))];
  delete out.savedViews;
  out.snapshots = (ex.snapshots || []).map((sn) => ({ ...sn, title: sn.title || sn.name }));
  out.pages = [...(ex.pages || []), ...(ex.conceptPages || []).map((t) => (typeof t === "string" ? { title: t, blocks: [] } : t))];
  delete out.conceptPages;
  if (ex.roamQueries) out.queries = ex.roamQueries;
  delete out.roamQueries;
  return out;
}

export function buildPlan(bp, { salt, author = "Svy", today = new Date() } = {}) {
  if (!salt) throw new Error("buildPlan needs a salt");
  const U = (key) => uidFor(salt, key);
  const ops = [];
  const warnings = [];
  const keys = new Set();
  const push = (op) => {
    if (keys.has(op.key)) throw new Error(`duplicate plan key ${op.key}`);
    keys.add(op.key);
    op.uid = op.uid || U(op.key);
    ops.push(op);
    return op.uid;
  };
  const block = (stage, key, parent, string, extra = {}) => push({ kind: "block", stage, key, parent, string, ...extra });
  const topProps = (props = {}) => ({ ...props, [MARK]: 1 });
  const children = (stage, keyBase, parent, list) => {
    (list || []).forEach((kid, i) => {
      const node = typeof kid === "string" ? { text: kid } : kid || {};
      const uid = block(stage, `${keyBase}.${i}`, parent, node.textResolved ?? node.text ?? "");
      if (node.children?.length) children(stage, `${keyBase}.${i}`, uid, node.children);
    });
  };

  const rootTitle = rootTitleOf(bp);
  const landmarks = new Set(Array.isArray(bp.extras?.landmarks) ? bp.extras.landmarks : []);
  bp = { ...bp, extras: normalizeExtras(bp.extras || {}, bp.library || []) };
  const sources = new Map((bp.library || []).map((s) => [s.id, s]));
  const boards = new Map((bp.boards || []).map((b) => [b.id, b]));
  const cards = new Map((bp.cards || []).map((c) => [c.id, c]));
  // Ids a blueprint may cite in ((…)) / ref: cards, notebook and inbox entries.
  const otherIds = new Set();
  for (const n of bp.extras.notebook || []) for (const b of n.blocks || []) if (b?.id) otherIds.add(b.id);
  const cardUidOf = (id) => (cards.has(id) ? U(`card:${id}`) : otherIds.has(id) ? U(`nbid:${id}`) : null);
  const cardsOn = new Map();
  for (const c of bp.cards || []) {
    if (!cardsOn.has(c.board)) cardsOn.set(c.board, []);
    cardsOn.get(c.board).push(c);
  }
  const nestedOf = new Map([...boards.values()].filter((b) => b.parent && b.card).map((b) => [b.card, b]));
  for (const c of bp.cards || []) if (c.type === "board" && c.child && boards.has(c.child) && !nestedOf.has(c.id)) nestedOf.set(c.id, boards.get(c.child));
  const root = [...boards.values()].find((b) => !b.parent);
  const rootPage = U("page:root");

  // ---- pages ----
  push({ kind: "page", stage: "pages", key: "page:root", title: rootTitle });
  const pageTitles = new Set([rootTitle]);
  const pdfs = [];
  for (const s of bp.library || []) {
    const title = libraryTitle(s);
    if (pageTitles.has(title)) { warnings.push(`library ${s.id}: title ${title} taken; adding id`); }
    const unique = pageTitles.has(title) ? `${title} (${s.id})` : title;
    pageTitles.add(unique);
    s._title = unique;
    if (s.kind === "pdf") {
      pdfs.push({
        id: s.id,
        title: unique,
        file: s.file || `${s.id}.pdf`,
        pageUid: U(`pdfpage:${s.id}`),
        pdfBlockUid: U(`pdf:${s.id}`),
        highlights: (s.highlights || []).map((h, i) => ({
          i,
          page: h.page,
          text: flatten(h.text),
          color: ["yellow", "red", "green", "blue", "purple"].includes(h.color) ? h.color : "yellow",
          note: h.note ? flatten(h.note) : "",
          tag: h.tag || "",
          noteUid: U(`hlnote:${s.id}:${i}`),
        })),
      });
    } else {
      const page = push({ kind: "page", stage: "pages", key: `page:lib:${s.id}`, title: unique });
      const lines = [
        `title:: ${flatten(s.title)}`,
        s.authors?.length ? `authors:: ${s.authors.join(", ")}` : "",
        s.year ? `year:: ${s.year}` : "",
        s.venue ? `venue:: ${flatten(s.venue)}` : "",
        s.url || s.landing ? `url:: ${s.url || s.landing}` : "",
        s.why ? `why:: ${flatten(s.why)}` : "",
      ].filter(Boolean);
      lines.forEach((line, i) => block("pages", `web:${s.id}:${i}`, page, line, i === 0 ? { props: topProps() } : { props: topProps() }));
      (s.highlights || []).forEach((h, i) => {
        const q = block("pages", `webq:${s.id}:${i}`, page, `> ${flatten(h.text)}`, { props: topProps() });
        if (h.note) block("pages", `webqn:${s.id}:${i}`, q, flatten(h.note));
      });
    }
  }
  for (const p of bp.extras?.pages || []) {
    if (!p?.title || !String(p.title).startsWith("PhD/")) { warnings.push(`extras.pages: ${p?.title} is outside PhD/ (skipped)`); continue; }
    if (pageTitles.has(p.title)) continue;
    pageTitles.add(p.title);
    if (!(p.blocks || []).length) {
      // A concept page with no text still gets one marker block: Roam drops a page that has no blocks and no refs.
      const page = push({ kind: "page", stage: "pages", key: `page:x:${p.title}`, title: p.title });
      block("pages", `xp:${p.title}:0`, page, "PhD concept page (stress build)", { props: topProps() });
      continue;
    }
    const page = push({ kind: "page", stage: "pages", key: `page:x:${p.title}`, title: p.title });
    (p.blocks || []).forEach((b, i) => {
      const node = typeof b === "string" ? { text: b } : b;
      const uid = block("pages", `xp:${p.title}:${i}`, page, textRefs(node.text, cardUidOf), { props: topProps() });
      if (node.children?.length) children("pages", `xp:${p.title}:${i}`, uid, node.children);
    });
  }

  // ---- structure ----
  const cardOps = new Map(); // card id -> op
  const placed = new Map(); // board id -> placeBoard result
  const absRect = new Map(); // card id -> absolute rect on its board
  const secRect = new Map(); // "board:section" -> absolute rect
  const libTitleOf = (id) => sources.get(id)?._title || `PhD/Library/${id}`;

  const writeBoardContent = (b, boardUid) => {
    const list = cardsOn.get(b.id) || [];
    const geo = placeBoard(b, list);
    placed.set(b.id, geo);
    const secAbs = new Map();
    const secParentUid = new Map();
    const order = [];
    const byId = new Map((b.sections || []).map((s) => [s.id, s]));
    const visit = (s, seen = new Set()) => {
      if (seen.has(s.id) || order.includes(s)) return;
      seen.add(s.id);
      if (s.parent && byId.has(s.parent)) visit(byId.get(s.parent), seen);
      order.push(s);
    };
    for (const s of b.sections || []) visit(s);
    for (const s of order) {
      const rel = geo.sections.get(s.id);
      const parentUid = s.parent ? secParentUid.get(s.parent) : boardUid;
      const pAbs = s.parent ? secAbs.get(s.parent) : { x: 0, y: 0 };
      secAbs.set(s.id, { x: pAbs.x + rel.x, y: pAbs.y + rel.y, w: rel.w, h: rel.h });
      secRect.set(`${b.id}:${s.id}`, secAbs.get(s.id));
      const layout = { type: "section", x: rel.x, y: rel.y, w: rel.w, h: rel.h, color: PALETTE.includes(s.color) ? s.color : undefined };
      if (s.look === "lane") { layout.look = "lane"; layout.axis = s.axis === "vertical" ? "vertical" : "horizontal"; }
      else if (s.look === "calendar" || s.look === "timer") layout.look = s.look;
      secParentUid.set(s.id, block("structure", `sec:${b.id}:${s.id}`, parentUid, flatten(s.title) || "Section", { props: { plexus: serializeItemLayout(layout) } }));
    }
    for (const c of list) {
      const rect = geo.cards.get(c.id);
      const parentUid = c.section ? secParentUid.get(c.section) : boardUid;
      const base = c.section ? secAbs.get(c.section) : { x: 0, y: 0 };
      absRect.set(c.id, { x: base.x + rect.x, y: base.y + rect.y, w: rect.w, h: rect.h });
      writeCard(c, parentUid, rect);
    }
  };

  const writeCard = (c, parentUid, rect) => {
    const key = `card:${c.id}`;
    const text = textRefs(c.text ?? "", cardUidOf);
    const src = c.source ? sources.get(c.source) : null;
    let string = text;
    let fallback;
    const kids = [...(c.children || [])].map((k) => (typeof k === "string" ? textRefs(k, cardUidOf) : { ...k, text: textRefs(k.text, cardUidOf) }));
    const layout = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    if (PALETTE.includes(c.color)) layout.color = c.color;
    let open;
    let boardChild = null;
    let isTable = false;
    let pin = null;
    let imgRegion = null;
    if (landmarks.has(c.id)) layout.landmark = true;
    if (src && c.highlight !== undefined) {
      const h = src.highlights[c.highlight];
      if (src.kind === "pdf") {
        string = `((⟦HL:${src.id}:${c.highlight}⟧))`;
        fallback = `> ${flatten(h.text)}`;
        if (text && text !== string) kids.unshift(text);
      } else string = `> ${flatten(h.text)}`;
      if (!kids.some((k) => /^Source::/.test(typeof k === "string" ? k : k.text))) kids.push(`Source:: ${pageCardString(src._title)}`);
    } else if (c.region && src?.kind === "pdf" && !c.region.target) {
      pin = { pinKey: `pin:${c.id}`, containerKey: `pins:${src.id}`, src };
      string = `((${U(pin.pinKey)}))`;
      if (text) kids.unshift(text);
    } else if (c.region?.target && cards.has(c.region.target)) {
      // A region card: the region lives under its target (an image card's regions, or the PDF's pins); the card is a ((ref)).
      const t = cards.get(c.region.target);
      const tsrc = t.source ? sources.get(t.source) : null;
      if (t.type === "image") {
        imgRegion = { target: t.id };
        string = `((${U(`region:${c.id}`)}))`;
      } else if (tsrc?.kind === "pdf") {
        pin = { pinKey: `pin:${c.id}`, containerKey: `pins:${tsrc.id}`, src: tsrc };
        string = `((${U(pin.pinKey)}))`;
      }
      if (text && string !== text) kids.unshift(text);
    } else {
      switch (c.type) {
        case "text": layout.type = "text"; string = text; break;
        case "quote": string = text.startsWith(">") ? text : `> ${text}`; break;
        case "pageref": string = /^#?\[\[/.test(text.trim()) ? text.trim() : pageCardString(cleanPageTitle(text, 150)); break;
        case "blockref": {
          const ref = c.ref ? textRefs(`((${c.ref}))`, cardUidOf) : text;
          string = ref;
          break;
        }
        case "pdf": string = pageCardString(libTitleOf(c.source)); if (text && text !== string) kids.unshift(text); break;
        case "image": {
          const alt = flatten(c.image?.caption || c.text || "").replace(/[[\]]/g, "");
          const url = c.image?.url || `⟦IMG:${c.id}⟧`;
          string = /^!\[[^\]]*\]\([^)]*\)$/.test(text.trim()) && (!c.image?.url || text.includes(c.image.url)) ? text.trim() : `![${alt.replace(/^!|\(.*$/g, "")}](${url})`;
          fallback = alt ? `Image: ${alt}` : "Image";
          break;
        }
        case "table":
        case "chart": {
          isTable = true;
          const rows = tableRowsOf(c);
          string = flatten(c.table?.caption || c.chart?.title || c.text) || `Table · ${rows.length} rows`;
          if (c.type === "chart" && !/chart/i.test(string)) string = `Chart → table: ${string}`;
          open = false;
          break;
        }
        case "query": {
          const q = String(c.query || text).trim();
          string = /^\{\{\s*(\[\[query\]\]|query)\s*:/.test(q) ? q : `{{[[query]]: ${q}}}`;
          if (c.query && text && text !== q) kids.unshift(text);
          break;
        }
        case "board": {
          const nested = nestedOf.get(c.id);
          string = boardString(flatten(nested?.title || c.text) || "Untitled board");
          layout.v = SCHEMA_VERSION;
          if (nested && BOARD_PATTERNS.includes(nested.bg)) layout.bg = nested.bg;
          open = false;
          boardChild = nested || null;
          if (text && nested && text !== nested.title) kids.unshift(text);
          break;
        }
        case "todo": string = ensureTodo(text); break;
        case "embed": {
          const ref = c.ref ? textRefs(`((${c.ref}))`, cardUidOf) : "";
          string = /^\{\{\s*\[\[embed/.test(text) ? text : `{{[[embed]]: ${ref || text}}}`;
          break;
        }
        case "web": string = c.url && !text.includes(c.url) ? `[${flatten(text).replace(/[[\]]/g, "") || c.url}](${c.url})` : text; break;
        default: string = text;
      }
      if (src && c.type !== "pdf" && !kids.some((k) => /^Source::/.test(typeof k === "string" ? k : k.text))) kids.push(`Source:: ${pageCardString(src._title)}`);
    }
    if (Array.isArray(c.tags) && c.tags.length) {
      const tags = c.tags.map((t) => `#[[${String(t).replace(/[[\]]/g, "")}]]`).join(" ");
      if (classifyString(shapeOf(string)).kind === "note" && !isTable) string = `${string} ${tags}`;
      else kids.push(`tags:: ${tags}`);
    }
    if (!isTable && c.type !== "board" && c.type !== "text") {
      const look = lookForNewString(shapeOf(string), "block");
      if (c.look === "card" || c.look === "block") layout.look = c.look;
      else if (look) layout.look = c.type === "claim" || c.type === "question" ? "card" : look;
    }
    const uid = block("structure", key, parentUid, string, { props: { plexus: serializeItemLayout(layout) }, open, fallback, card: c.id });
    cardOps.set(c.id, ops[ops.length - 1]);
    if (imgRegion) {
      const targetUid = U(`card:${imgRegion.target}`);
      const ck = `regions:${imgRegion.target}`;
      if (!keys.has(ck)) block("structure", ck, targetUid, CONTAINER_STRING, { open: false, props: { plexus: { type: "regions" } } });
      const [rx, ry, rw, rh] = c.region.f;
      const rs = imageRegionString(targetUid, { rx, ry, rw, rh }, flatten(c.region.caption || c.text || "").slice(0, 300));
      if (rs) block("structure", `region:${c.id}`, U(ck), rs);
    }
    if (pin) {
      // The pin lives under the PDF block (Plexus planPinWrites: container then pin). The pdf block is made in the pdf stage.
      const pdfBlock = U(`pdf:${pin.src.id}`);
      if (!keys.has(pin.containerKey)) {
        block("structure", pin.containerKey, pdfBlock, PIN_CONTAINER_STRING, { open: false, props: { plexus: { type: "regions" } }, after: "pdf" });
      }
      block("structure", pin.pinKey, U(pin.containerKey), serializeRegion({ kind: "pdf", drawingUid: pdfBlock, pg: c.region.page || c.page || 1, f: c.region.f, caption: flatten(c.region.caption || c.text || "").slice(0, 300) }), { after: "pdf" });
    }
    if (isTable) {
      const tableUid = block("structure", `table:${c.id}`, uid, TABLE_ROOT);
      const rows = tableRowsOf(c);
      rows.forEach((row, r) => {
        let parent = tableUid;
        (Array.isArray(row) ? row : [row]).forEach((cell, col) => {
          parent = block("structure", `cell:${c.id}:${r}:${col}`, parent, flatten(cell));
        });
      });
    }
    children("structure", `kid:${c.id}`, uid, kids);
    if (c.type === "image" && c.region && !c.region.target) {
      const ck = `regions:${c.id}`;
      const container = keys.has(ck) ? U(ck) : block("structure", ck, uid, CONTAINER_STRING, { open: false, props: { plexus: { type: "regions" } } });
      const [rx, ry, rw, rh] = c.region.f;
      const s = imageRegionString(uid, { rx, ry, rw, rh }, flatten(c.region.caption || "").slice(0, 300));
      if (s) block("structure", `region:${c.id}`, container, s);
    }
    if (boardChild) writeBoardContent(boardChild, uid);
    return uid;
  };

  if (root) {
    const rootLayout = { v: SCHEMA_VERSION };
    if (BOARD_PATTERNS.includes(root.bg)) rootLayout.bg = root.bg;
    const boardUid = block("structure", `board:${root.id}`, rootPage, boardString(flatten(root.title) || "Dissertation map"), { open: false, props: topProps({ plexus: serializeItemLayout(rootLayout) }) });
    writeBoardContent(root, boardUid);
  }
  const boardUidOf = (id) => (id === root?.id ? U(`board:${id}`) : U(`card:${boards.get(id)?.card}`));
  for (const b of boards.values()) {
    if (b.parent && !(b.card && cards.has(b.card))) warnings.push(`board ${b.id}: no card in its parent; not written`);
  }

  // ---- edges ----
  const edgeUid = new Map();
  const edgeContainers = new Set();
  const edgeOrder = [...(bp.edges || [])].sort((a, b) => (cards.has(a.to) ? 0 : 1) - (cards.has(b.to) ? 0 : 1));
  const edgeKey = (e) => `edge:${e.id || `${e.from}>${e.to}#${e.label || ""}#${e.fromCell || ""}#${e.toCell || ""}`}`;
  for (const e of edgeOrder) {
    const a = cards.get(e.from);
    const toCard = cards.get(e.to);
    const toEdge = !toCard ? edgeUid.get(e.to) : null;
    if (!a || (!toCard && !toEdge)) { warnings.push(`edge ${e.from}->${e.to}: endpoint missing (skipped)`); continue; }
    const boardId = a.board;
    if (toCard && toCard.board !== boardId) { warnings.push(`edge ${e.from}->${e.to}: crosses boards (skipped)`); continue; }
    const bUid = boardUidOf(boardId);
    const containerKey = `edges:${boardId}`;
    if (!edgeContainers.has(containerKey)) {
      edgeContainers.add(containerKey);
      block("edges", containerKey, bUid, "Connections", { open: false, props: { plexus: { type: "edges" } } });
    }
    const from = U(`card:${e.from}`);
    const to = toCard ? U(`card:${e.to}`) : toEdge;
    const cellUid = (id, cell) => (Array.isArray(cell) && cell.length === 2 ? U(`cell:${id}:${cell[0]}:${cell[1]}`) : undefined);
    let fromBlock = cellUid(e.from, e.fromCell);
    let toBlock = toCard ? cellUid(e.to, e.toCell) : undefined;
    if (e.toRegion && toCard?.region && toCard.type === "image") toBlock = U(`region:${e.to}`);
    if (e.fromRegion && a.region && a.type === "image") fromBlock = U(`region:${e.from}`);
    const dir = e.both ? "two" : e.dir === "none" ? "none" : "one";
    const edge = { from, to, dir, fromBlock, toBlock };
    if (e.kind === "contradicts") edge.dash = "dashed";
    if (e.kind === "causes") edge.weight = 2;
    if (e.route && ["curve", "straight", "elbow", "around"].includes(e.route)) edge.route = e.route;
    const label = flatten(e.label || "");
    const src = fromBlock ? `((${fromBlock}))` : `⟦REF:${e.from}⟧`;
    const dst = toBlock ? `((${toBlock}))` : toCard ? `⟦REF:${e.to}⟧` : `((${toEdge}))`;
    const arrow = { one: "→", two: "↔", none: "—" }[dir];
    const string = label ? `${src} ${arrow} ${label} ${arrow} ${dst}` : `${src} ${arrow} ${dst}`;
    const key = edgeKey(e);
    if (keys.has(key)) { warnings.push(`edge ${key}: duplicate (skipped)`); continue; }
    const uid = block("edges", key, U(containerKey), string, { props: { plexus: serializeEdge(edge) } });
    if (e.id) edgeUid.set(e.id, uid);
  }

  // ---- extras ----
  const ex = bp.extras || {};
  const commentList = [...(bp.cards || []).filter((c) => c.comment).map((c) => ({ card: c.id, text: c.comment })), ...(ex.comments || [])];
  if (commentList.length) {
    const container = block("extras", "comments:root", rootPage, COMMENTS_CONTAINER_STRING, { open: false, props: topProps() });
    const date = block("extras", "comments:date", container, `[[${dailyPageTitle(today)}]]`);
    const authors = new Map();
    const anchors = new Map();
    let n = 0;
    for (const cm of commentList) {
      const c = cards.get(cm.card);
      if (!c || !cm.text) { warnings.push(`comment on ${cm.card}: card missing`); continue; }
      const who = cm.author || author;
      if (!authors.has(who)) authors.set(who, block("extras", `comments:author:${who}`, date, `[[${who}]]`));
      const akey = `${who}|${c.id}`;
      if (!anchors.has(akey)) {
        // Highlight / block-ref cards: the comment belongs to the block the card shows (commentTargetUid).
        const target = c.source && c.highlight !== undefined ? `⟦HL:${c.source}:${c.highlight}⟧` : U(`card:${c.id}`);
        anchors.set(akey, block("extras", `comments:anchor:${akey}`, authors.get(who), target.startsWith("⟦") ? `((${target}))` : commentAnchorString(target), { fallback: commentAnchorString(U(`card:${c.id}`)) }));
      }
      block("extras", `comment:${n += 1}`, anchors.get(akey), flatten(cm.text));
    }
  }
  const boardWorld = (boardId, ids, secIds = []) => {
    const rects = [...ids.map((id) => absRect.get(id)), ...secIds.map((id) => secRect.get(`${boardId}:${id}`))].filter(Boolean);
    if (!rects.length) return null;
    const x = Math.min(...rects.map((r) => r.x)) - 48;
    const y = Math.min(...rects.map((r) => r.y)) - 48;
    const r = Math.max(...rects.map((q) => q.x + q.w)) + 48;
    const btm = Math.max(...rects.map((q) => q.y + q.h)) + 48;
    return [x, y, r - x, btm - y];
  };
  // A board item a blueprint names: a card or a section of that board.
  const itemUid = (boardId, id) => (cards.get(id)?.board === boardId ? U(`card:${id}`) : secRect.has(`${boardId}:${id}`) ? U(`sec:${boardId}:${id}`) : null);
  const regionsFor = new Set();
  (ex.views || []).forEach((v, i) => {
    if (!boards.has(v.board)) { warnings.push(`view ${i}: board ${v.board} missing`); return; }
    const ids = (v.cards || []).filter((id) => cards.get(id)?.board === v.board);
    const secIds = (v.sections || []).filter((id) => secRect.has(`${v.board}:${id}`));
    // A view that names nothing frames the whole board ("Whole map", a kanban board's full view).
    const whole = !ids.length && !secIds.length;
    const rect = Array.isArray(v.rect) ? v.rect : whole
      ? boardWorld(v.board, (cardsOn.get(v.board) || []).map((c) => c.id), (boards.get(v.board).sections || []).map((x) => x.id))
      : boardWorld(v.board, ids, secIds);
    if (!rect) { warnings.push(`view ${i}: no cards to frame`); return; }
    const bUid = boardUidOf(v.board);
    const string = viewBlockString({ drawingUid: bUid, caption: flatten(v.caption || v.name || `View ${i + 1}`), v: rect, ids: [...ids.map((id) => U(`card:${id}`)), ...secIds.map((id) => U(`sec:${v.board}:${id}`))] });
    if (!string) { warnings.push(`view ${i}: rejected by viewBlockString`); return; }
    const ck = `views:${v.board}`;
    if (!regionsFor.has(ck)) { regionsFor.add(ck); block("extras", ck, bUid, CONTAINER_STRING, { open: false, props: { plexus: { type: "regions" } } }); }
    block("extras", `view:${v.board}:${i}`, U(ck), string);
  });
  const snapFor = new Set();
  (ex.snapshots || []).forEach((s, i) => {
    const b = boards.get(s.board);
    if (!b) { warnings.push(`snapshot ${i}: board ${s.board} missing`); return; }
    const geo = placed.get(s.board);
    const bUid = boardUidOf(s.board);
    const items = [];
    for (const sec of b.sections || []) {
      const r = geo.sections.get(sec.id);
      items.push({ uid: U(`sec:${b.id}:${sec.id}`), x: r.x, y: r.y, w: r.w, h: r.h, color: sec.color || null, collapsed: false, parent: sec.parent ? U(`sec:${b.id}:${sec.parent}`) : bUid });
    }
    for (const c of cardsOn.get(b.id) || []) {
      const r = geo.cards.get(c.id);
      const dx = s.shift ? (s.shift[0] || 0) : 0;
      const dy = s.shift ? (s.shift[1] || 0) : 0;
      items.push({ uid: U(`card:${c.id}`), x: r.x + dx, y: r.y + dy, w: r.w, h: r.h, color: c.color || null, collapsed: false, parent: c.section ? U(`sec:${b.id}:${c.section}`) : bUid });
    }
    const ck = `snaps:${s.board}`;
    if (!snapFor.has(ck)) { snapFor.add(ck); block("extras", ck, bUid, "Snapshots", { open: false, props: { plexus: { type: "snapshots" } } }); }
    const when = s.date ? new Date(s.date) : new Date(today.getTime() - (i + 1) * 86400000);
    block("extras", `snap:${s.board}:${i}`, U(ck), flatten(s.title) || snapshotTitle(when), { props: { plexus: snapshotProps(items) } });
  });
  const trailFor = new Set();
  (ex.trails || []).forEach((t, i) => {
    if (!boards.has(t.board)) { warnings.push(`trail ${i}: board ${t.board} missing`); return; }
    const bUid = boardUidOf(t.board);
    const ck = `trails:${t.board}`;
    if (!trailFor.has(ck)) { trailFor.add(ck); block("extras", ck, bUid, "Trails", { open: false, props: { plexus: { type: "trails" } } }); }
    const trail = block("extras", `trail:${t.board}:${i}`, U(ck), trailString(flatten(t.name)), { open: true, props: { plexus: { type: "trail" } } });
    (t.stops || []).forEach((stop, j) => {
      const id = typeof stop === "string" ? stop : stop?.card;
      const stopUid = itemUid(t.board, id);
      if (!stopUid) { warnings.push(`trail ${i} stop ${j}: ${id} not on ${t.board}`); return; }
      const s = block("extras", `stop:${t.board}:${i}:${j}`, trail, `((${stopUid}))`, { open: true });
      if (stop?.note) block("extras", `stopnote:${t.board}:${i}:${j}`, s, flatten(stop.note));
    });
  });
  const daily = [];
  const nbKey = (b, i, j) => (b?.id ? `nbid:${b.id}` : `nb:${i}:${j}`);
  (ex.notebook || []).forEach((nb, i) => {
    let pageUid;
    if (nb.title) {
      if (!String(nb.title).startsWith("PhD/")) { warnings.push(`notebook ${i}: ${nb.title} outside PhD/`); return; }
      const key = `page:x:${nb.title}`;
      pageUid = keys.has(key) ? U(key) : push({ kind: "page", stage: "extras", key, title: nb.title });
    } else {
      const d = nb.dailyTitle ? parseDailyTitle(nb.dailyTitle) : new Date(`${nb.date}T12:00:00`);
      if (!d || Number.isNaN(d.getTime())) { warnings.push(`notebook ${i}: bad date ${nb.dailyTitle || nb.date}`); return; }
      const title = dailyPageTitle(d);
      const pad = (n) => String(n).padStart(2, "0");
      pageUid = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
      const key = `daily:${pageUid}`;
      if (!keys.has(key)) { push({ kind: "page", stage: "extras", key, uid: pageUid, title, daily: true }); daily.push({ uid: pageUid, title }); }
    }
    (nb.blocks || []).forEach((b, j) => {
      const node = typeof b === "string" ? { text: b } : b;
      const k = nbKey(node, i, j);
      if (keys.has(k)) { warnings.push(`notebook ${node.id}: duplicate id`); return; }
      const uid = block("extras", k, pageUid, textRefs(node.text, cardUidOf), { props: topProps() });
      if (node.children?.length) children("extras", k, uid, node.children);
    });
  });
  (ex.queries || []).forEach((q, i) => {
    const text = typeof q === "string" ? q : q?.text;
    if (text) block("extras", `query:${i}`, rootPage, text, { props: topProps() });
  });
  for (const k of Object.keys(ex)) if (!["notebook", "comments", "views", "snapshots", "trails", "pages", "queries"].includes(k)) warnings.push(`extras.${k}: not built (unknown key)`);

  return { rootTitle, rootPage, ops, pdfs, daily, warnings, cardOps, absRect, boardUidOf, salt };
}

// Resolve placeholders. ctx: { hl(source, index) -> uid|null, img(cardId) -> url|null, cardString(cardId) -> resolved
// string|null, cardUid(cardId) }. Returns the string, or null when something could not be resolved.
export function resolveString(string, ctx) {
  let missing = false;
  const out = String(string ?? "").replace(PH, (m, kind, arg) => {
    if (kind === "HL") {
      const [source, index] = arg.split(":");
      const uid = ctx.hl(source, Number(index));
      if (!uid) missing = true;
      return uid || m;
    }
    if (kind === "IMG") {
      const url = ctx.img(arg);
      if (!url) missing = true;
      return url || m;
    }
    const s = ctx.cardString(arg);
    if (s == null) { missing = true; return m; }
    return refFor(s, ctx.cardUid(arg));
  });
  return missing ? null : out;
}
