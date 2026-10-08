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
