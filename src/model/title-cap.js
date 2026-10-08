// Titles are cut on a word boundary at about 80 characters, with an ellipsis. Never mid-word.
export const TITLE_CAP = 80;

export function capTitle(text, cap = TITLE_CAP) {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (clean.length <= cap) return clean;
  const cut = clean.slice(0, cap + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > 0 ? cut.slice(0, space) : clean.slice(0, cap)).replace(/[\s,;:.\-–—]+$/, "");
  return `${head}…`;
}

// The PDF's own Title field sometimes holds a cut-off first word of the heading ("NOTIFIABL").
export function isCutPrefix(title, heading) {
  const t = typeof title === "string" ? title.trim() : "";
  const h = typeof heading === "string" ? heading.replace(/\s+/g, " ").trim() : "";
  return t.length > 0 && h.length > t.length && h.toLowerCase().startsWith(t.toLowerCase()) && /\S/.test(h[t.length]);
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const JUNK_LINE_RES = [
  /^\W*\d{1,4}\W*$/,
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/,
  /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/,
  new RegExp(`^(?:\\d{1,2}\\s+)?(?:${MONTHS})\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}$`, "i"),
  /\bcontents lists? available at\b/i,
  /\bjournal homepage\b/i,
  /\b(?:https?:\/\/|www\.)\S+/i,
  /\b[\w-]+\.(?:com|org|edu|gov|net|eu)\b/i,
  /\bdoi\b\s*[:.]?|\b10\.\d{4,9}\//i,
  /\bvol(?:ume)?\.?\s*\d+|\bissue\s+\d+|\bno\.\s*\d+\s*[,(]|\(\d{4}\)\s*\d{2,}/i,
  /^(?:©|copyright\b)|\ball rights reserved\b/i,
  /^(?:available online|received|accepted|revised|keywords?|abstract|article info|a r t i c l e)\b/i,
  /^L\s*\d+\/\d+$/,
];

// A line that is page furniture or journal chrome, never a paper title: dates, page numbers,
// volume/issue lines, URLs, DOIs, "Contents lists available at", "journal homepage".
export function isJunkTitleText(text) {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!t) return true;
  return JUNK_LINE_RES.some((re) => re.test(t));
}

export function titleWordCount(text) {
  return String(text ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
