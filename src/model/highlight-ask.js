// Ask AI about one native PDF highlight (a highlight card, or a row in the reader's highlight drawer).
// Focus: the highlight's text and page, plus the parsed text around it when the PDF has a parse.
// An area highlight sends its snapshot as the figure image. Pure: the caller loads the parse and the block.

import { imageDoc, selectionDoc } from "./ai-context.js";
import { makePart } from "./ask-basket.js";

const IMAGE_MD = /!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/;

export function highlightImageUrl(string) {
  const m = IMAGE_MD.exec(String(string ?? ""));
  return m ? m[1] : "";
}

// { highlight: highlightModel(...), string, uid, parsed?, title? } ->
// { doc, focus, image, source, label } or null when there is nothing to ask about.
export function highlightAsk({ highlight, string = "", uid = "", parsed = null, title = "" } = {}) {
  if (!highlight || typeof highlight !== "object") return null;
  const page = Number.isInteger(highlight.page) && highlight.page >= 1 ? highlight.page : null;
  const text = String(highlight.text ?? "").replace(/\s+/g, " ").trim();
  const note = String(highlight.note ?? "").replace(/\s+/g, " ").trim();
  const imageUrl = highlight.image ? highlightImageUrl(string) : "";
  const hasParse = Boolean(parsed && parsed.blocks && Object.keys(parsed.blocks).length);
  const caption = [note, page ? `Highlight on p. ${page}` : "Highlight"].filter(Boolean).join(" — ");
  const image = imageUrl ? { key: "", url: imageUrl, caption, name: "highlight", thumb: imageUrl } : null;
  const source = uid ? { sourceUid: uid } : {};
  if (highlight.image) {
    if (!imageUrl) return null;
    if (hasParse && page) return { doc: parsed, focus: { page }, image, source, label: `Area · p. ${page}` };
    return { doc: imageDoc({ caption, title }), focus: { blockId: "img" }, image, source, label: page ? `Area · p. ${page}` : "Area" };
  }
  if (!text) return null;
  if (hasParse) return { doc: parsed, focus: { selection: text, ...(page ? { page } : {}) }, image: null, source, label: "" };
  return { doc: selectionDoc({ text, page: page || 1, title }), focus: { blockId: "sel", selection: text }, image: null, source, label: "" };
}

// The basket part. The key is the highlight's own uid, so two area highlights on one page stay two parts.
export function highlightPart(ask, { uid = "", pdfUid = "", url = "" } = {}) {
  if (!ask) return null;
  const part = makePart({ doc: ask.doc, focus: ask.focus, pdfUid, url, image: ask.image, source: ask.source });
  if (uid) part.key = `hl:${uid}`;
  if (ask.label) part.label = [ask.label, part.docTitle].filter(Boolean).join(" · ");
  return part;
}
