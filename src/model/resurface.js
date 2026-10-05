// Daily-page resurface matching. No Roam calls.

export const DEFAULT_INTERVALS = Object.freeze([7, 30, 90, 365]);
export const RESURFACE_CAP = 6;
const DAY = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Local midnight of a Roam daily title. "October 5th, 2026" → that day's local time.
export function pageTitleToDate(title) {
  const match = String(title ?? "").trim().match(/^([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th), (\d{4})$/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 0) return null;
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date.getTime();
}

export function parseIntervals(text) {
  const nums = String(text ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? nums : [...DEFAULT_INTERVALS];
}

export function intervalLabel(days) {
  if (days === 7) return "1 week ago";
  if (days === 30) return "1 month ago";
  if (days === 90) return "3 months ago";
  if (days === 365) return "1 year ago";
  if (days % 365 === 0) return `${days / 365} years ago`;
  return `${days} days ago`;
}

export function matchResurface(rows, pageDate, intervals, { slack = DAY, cap = RESURFACE_CAP } = {}) {
  const page = pageDate instanceof Date ? pageDate.getTime() : Number(pageDate);
  if (!Number.isFinite(page)) return [];
  const tabs = [];
  for (const days of intervals || []) {
    if (!Number.isFinite(days) || days <= 0) continue;
    const target = page - days * DAY;
    const hits = [];
    for (const row of rows || []) {
      if (!row?.uid || !Number.isFinite(row.time)) continue;
      const delta = Math.abs(row.time - target);
      if (delta <= slack) hits.push({ ...row, delta });
    }
    hits.sort((a, b) => a.delta - b.delta || String(a.uid).localeCompare(String(b.uid)));
    if (hits.length) tabs.push({ days, label: intervalLabel(days), items: hits.slice(0, cap) });
  }
  return tabs;
}
