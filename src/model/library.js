// Add-panel library filters. Queries stay in the host. This module only narrows rows the host already fetched.
import { dailyPageTitle } from "./schema.js";

export const LIBRARY_TYPES = ["all", "page", "block", "board", "daily"];
const LIBRARY_CAP = 80;
const DAY_MS = 86400000;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DAILY_RE = new RegExp(`^(${MONTHS}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);

export function isDailyTitle(title) {
  const m = DAILY_RE.exec(String(title ?? ""));
  if (!m) return false;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return false;
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return m[3] === suffix;
}

function cleanTag(raw) {
  let tag = String(raw ?? "").trim();
  if (tag.startsWith("#")) tag = tag.slice(1).trim();
  const wiki = /^\[\[([\s\S]+)\]\]$/.exec(tag);
  if (wiki) tag = wiki[1].trim();
  return tag;
}

export function normalizeLibraryFilter(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const type = LIBRARY_TYPES.includes(src.type) ? src.type : "all";
  const daysN = Number(src.days);
  const days = Number.isFinite(daysN) ? Math.max(0, Math.floor(daysN)) : 0;
  return {
    type,
    tag: cleanTag(src.tag),
    days,
    orphan: src.orphan === true,
    text: String(src.text ?? "").trim(),
  };
}

export function libraryFilterActive(filter) {
  const f = normalizeLibraryFilter(filter);
  return Boolean(f.text || f.tag || f.days || f.orphan || f.type !== "all");
}

// A full-graph scan for "edited in N days" or "not on any board" alone is too wide.
// Daily titles and diagram boards are bounded. Text and tag hit an index.
export function librarySelective(filter) {
  const f = normalizeLibraryFilter(filter);
  if (f.text || f.tag) return true;
  return f.type === "board" || f.type === "daily";
}

export function editedSince(edited, days, now = Date.now()) {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  if (!n) return true;
  const t = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(edited) && edited > t - n * DAY_MS;
}

export function libraryKind(row) {
  if (row?.kind === "board") return "board";
  if (row?.kind === "block") return "block";
  const title = row?.title ?? "";
  if (row?.kind === "daily" || isDailyTitle(title)) return "daily";
  return "page";
}

export function narrowLibrary(rows, filter, now = Date.now()) {
  const f = normalizeLibraryFilter(filter);
  const needle = f.text.toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const kind = libraryKind(row);
    if (f.type !== "all" && kind !== f.type) return false;
    if (f.tag) {
      const tags = Array.isArray(row?.tags) ? row.tags : [];
      if (!tags.includes(f.tag)) return false;
    }
    if (needle) {
      const hay = [row?.title, row?.string, row?.text].filter((v) => v != null).join("\n").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (f.days && !editedSince(row?.edited, f.days, now)) return false;
    if (f.orphan && (kind === "board" || row?.onBoard)) return false;
    return true;
  });
}

export function libraryCard(row) {
  const kind = libraryKind(row);
  if (kind === "page" || kind === "daily") {
    const title = String(row?.title ?? row?.text ?? "");
    return { string: `[[${title}]]`, text: title, kind, label: kind === "daily" ? "daily" : "page" };
  }
  const uid = String(row?.uid ?? "");
  if (kind === "board") {
    const title = String(row?.title || "Untitled board");
    const label = row?.pageTitle ? `board · ${row.pageTitle}` : "board";
    return { string: `((${uid}))`, text: title, kind, label };
  }
  const label = row?.pageTitle ? `in ${row.pageTitle}` : "block";
  return { string: `((${uid}))`, text: String(row?.string ?? row?.text ?? "").slice(0, 120), kind, label };
}

// Local noon, so a DST shift does not skip a daily note. `days` is how many titles, newest first.
export function recentDailyTitles(days = 14, now = new Date()) {
  const n = Math.max(1, Math.min(366, Math.floor(Number(days) || 14)));
  const base = now instanceof Date ? now : new Date(now);
  const titles = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12, 0, 0, 0);
    titles.push(dailyPageTitle(d));
  }
  return titles;
}

export function libraryCap() {
  return LIBRARY_CAP;
}
