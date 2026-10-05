// PDF-7 page chips. Groups highlight rows for one pdf url. No writes.

import { pdfMacroUrl } from "./pdf.js";

function wholePage(page) {
  return typeof page === "number" && Number.isInteger(page) && page >= 1;
}

export function pageChips(rows, url) {
  if (typeof url !== "string" || url === "") return [];
  if (!Array.isArray(rows)) return [];
  const byPage = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.url !== url) continue;
    if (!wholePage(row.page)) continue;
    if (typeof row.uid !== "string" || row.uid === "") continue;
    let chip = byPage.get(row.page);
    if (!chip) {
      chip = { page: row.page, uids: [] };
      byPage.set(row.page, chip);
    }
    chip.uids.push(row.uid);
  }
  return [...byPage.values()]
    .sort((a, b) => a.page - b.page)
    .map((chip) => ({ page: chip.page, uids: chip.uids, count: chip.uids.length }));
}

export function firstChipUid(chip) {
  const uids = chip && Array.isArray(chip.uids) ? chip.uids : null;
  const uid = uids && uids.length > 0 ? uids[0] : "";
  return typeof uid === "string" ? uid : "";
}

export function highlightPill(page) {
  if (!wholePage(page)) return "";
  return `p. ${page}`;
}

// Rows for one pdf card. lookup.source is the card macro. pageUid and pageUrl scope each highlight.
export function chipsForPdf(item, items, lookup) {
  if (item?.kind !== "pdf") return [];
  const source = typeof lookup?.source === "function" ? lookup.source(item) : "";
  const url = pdfMacroUrl(typeof source === "string" ? source : "");
  if (!url) return [];
  const rows = [];
  const list = items && typeof items.values === "function" ? items.values() : [];
  for (const other of list) {
    if (other?.kind !== "highlight" || !other.target?.uid) continue;
    const pageUid = typeof lookup.pageUid === "function" ? (lookup.pageUid(other.target.uid) || "") : "";
    const pageUrl = pageUid && typeof lookup.pageUrl === "function" ? (lookup.pageUrl(pageUid) || "") : "";
    rows.push({ page: other.highlight?.page, uid: other.uid, url: pageUrl });
  }
  return pageChips(rows, url);
}
