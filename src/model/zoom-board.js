// The block Roam has zoomed, when that block lives on a board page.
// Page-card children live on the referenced page, so their parent walk never
// hits the diagram and this returns null. The diagram itself is not a card.
// Nothing here reads the graph. The caller passes the readers.

const MAX_STEPS = 24;

const parentUidOf = (loc) => {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  return String(loc.parentUid || "");
};

const connectionsHeader = (text) => String(text || "").split("\n")[0].trim() === "Connections";

export function zoomBoardTarget(blockUid, readers = {}) {
  const start = String(blockUid || "");
  if (!start) return null;
  const parentOf = readers.parentOf;
  const isDiagram = readers.isDiagram;
  if (typeof parentOf !== "function" || typeof isDiagram !== "function") return null;
  const isSection = readers.isSection;
  const blockString = readers.blockString;

  // From the zoomed block up to, but not including, the diagram.
  const down = [];
  const seen = new Set();
  let uid = start;
  let boardUid = "";
  for (let i = 0; i < MAX_STEPS; i += 1) {
    if (!uid || seen.has(uid)) return null;
    seen.add(uid);
    let diagram = false;
    try { diagram = isDiagram(uid) === true; } catch { return null; }
    if (diagram) {
      if (uid === start) return null;
      boardUid = uid;
      break;
    }
    down.push(uid);
    let parent = "";
    try { parent = parentUidOf(parentOf(uid)); } catch { return null; }
    if (!parent) return null;
    uid = parent;
  }
  if (!boardUid) return null;

  let cardUid = "";
  for (let i = down.length - 1; i >= 0; i -= 1) {
    const id = down[i];
    let section = false;
    try { section = typeof isSection === "function" && isSection(id) === true; } catch { section = false; }
    let text = "";
    try { text = typeof blockString === "function" ? blockString(id) || "" : ""; } catch { text = ""; }
    if (section || connectionsHeader(text)) continue;
    cardUid = id;
    break;
  }
  if (!cardUid) return null;
  return { boardUid, cardUid, blockUid: start };
}
