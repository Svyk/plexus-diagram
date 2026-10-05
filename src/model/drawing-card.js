// ECO-4. The card is a ref. Create writes the macro string and no props.

export const DRAWING_STRING = "{{[[excalidraw]]}}";
const ALT_DRAWING_STRING = "{{excalidraw}}";

// Roam uids and dashed UUIDs. 36 is the dashed-UUID length.
const UID_RE = /^[A-Za-z0-9_-]{1,36}$/;

export function isDrawingString(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.startsWith(DRAWING_STRING) || text.startsWith(ALT_DRAWING_STRING);
}

export function drawingRefString(uid) {
  return typeof uid === "string" && UID_RE.test(uid) ? `((${uid}))` : null;
}

export function drawingRefModel(targetString) {
  if (!isDrawingString(targetString)) return null;
  return { kind: "drawing-ref" };
}

export function drawingCreateSpec(boardUid) {
  return { parentUid: boardUid, order: "last", string: DRAWING_STRING };
}

export const regionMenuKinds = Object.freeze(["area", "rect", "frame"]);

export function regionBecomesCrop(kind) {
  return regionMenuKinds.includes(kind);
}

const REF_ONLY = /^\(\(([^)]+)\)\)$/;

// Uids whose block string is a drawing. The drop still makes a ref and does not move the source.
export function droppedDrawingUids(strings, blockString) {
  const out = [];
  for (const string of strings || []) {
    const match = String(string ?? "").trim().match(REF_ONLY);
    if (!match) continue;
    let text = "";
    try { text = blockString?.(match[1]) || ""; } catch { text = ""; }
    if (isDrawingString(text)) out.push(match[1]);
  }
  return out;
}

export const DRAWING_DROP_TOAST = "Drawings stay where they are; this is a reference";
