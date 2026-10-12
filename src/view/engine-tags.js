// Free or paid, in the same words wherever an engine is named: the engine menu, the Engines sheet, the
// status chip and the tooltips. Local engines run on this computer and cost nothing; cloud engines spend
// the user's own credits.

export const TAG_MAC = "Free · on this Mac";
export const TAG_ROAM = "Free · in Roam";
export const TAG_LLAMA = "Cloud · uses your LlamaParse credits";
export const TAG_MISTRAL = "Cloud · uses your Mistral credits";

export const tagKind = (text) => (String(text).startsWith("Free") ? "free" : "cloud");

export function pagesText(n) {
  const count = Number(n);
  if (!Number.isFinite(count) || count < 1) return "";
  return count === 1 ? "1 page" : `${count} pages`;
}

// "Docling · free · 110 pages · 42 s". Missing parts drop out.
export function localChipText(name, { pages = 0, seconds = "" } = {}) {
  return [name, "free", pagesText(pages), seconds].filter(Boolean).join(" · ");
}
