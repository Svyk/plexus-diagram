// HEP-4. Source chip for a highlight dragged off a reading page.
// Computed on read from the page title and an Author:: child. Nothing is written, and the author is never copied into props.

const READING_PREFIXES = ["Articles/", "Media Captures/"];
const AUTHOR_PREFIX = "Author::";

function readingTitle(title) {
  const text = typeof title === "string" ? title.trim() : "";
  if (!text) return "";
  return READING_PREFIXES.some((prefix) => text.startsWith(prefix)) ? text : "";
}

function childString(child) {
  if (typeof child === "string") return child;
  if (!child || typeof child !== "object") return "";
  const raw = child[":block/string"] ?? child.string;
  return typeof raw === "string" ? raw : "";
}

// Trim, then drop Roam page-ref brackets so [[Ada Lovelace]] paints as Ada Lovelace.
function cleanAuthor(raw) {
  return String(raw ?? "").replace(/\[\[|\]\]/g, "").trim();
}

function authorFrom(children) {
  const list = Array.isArray(children) ? children : [];
  for (const child of list) {
    const text = childString(child).trim();
    if (!text.startsWith(AUTHOR_PREFIX)) continue;
    const author = cleanAuthor(text.slice(AUTHOR_PREFIX.length));
    if (author) return author;
  }
  return "";
}

// The Author:: block among a page's children, for a watch that follows a rename.
export function authorBlockUid(children) {
  const list = Array.isArray(children) ? children : [];
  for (const child of list) {
    if (!childString(child).trim().startsWith(AUTHOR_PREFIX)) continue;
    const uid = child?.[":block/uid"] ?? child?.uid;
    if (typeof uid === "string" && uid) return uid;
  }
  return "";
}

// Chip after its author block changed. A string that no longer starts with Author:: drops the author.
export function chipWithAuthor(chip, authorString) {
  if (!chip || typeof chip !== "object") return null;
  const author = authorFrom([String(authorString ?? "")]);
  return { ...chip, author, text: author ? `${chip.title} · ${author}` : chip.title };
}

// Null for any page that is not Articles/ or Media Captures/.
export function sourceChipFor({ pageTitle, pageUid, pageChildren } = {}) {
  const title = readingTitle(pageTitle);
  if (!title) return null;
  const author = authorFrom(pageChildren);
  const uid = typeof pageUid === "string" ? pageUid : "";
  return {
    title,
    author,
    pageUid: uid,
    text: author ? `${title} · ${author}` : title,
  };
}

// Content key. An author rename changes it, so the card repaints on the next pass.
export function sourceChipKey(chip) {
  if (!chip || typeof chip !== "object") return "";
  return [chip.pageUid || "", chip.title || "", chip.author || "", chip.text || ""].join("\u0001");
}

// Button on the card. Click and Enter open the source page. pointerdown and mousedown stay
// on the chip: Roam enters edit when mousedown reaches the block.
export function buildSourceChip(doc, chip, { onOpen } = {}) {
  if (!chip || typeof doc?.createElement !== "function") return null;
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("type", "button");
  button.className = "pxd-chip pxd-chip--source";
  button.textContent = chip.text || "";
  button.setAttribute("aria-label", `Open ${chip.text || chip.title || "source"}`);
  const stop = (event) => { event.stopPropagation?.(); };
  button.addEventListener("pointerdown", stop);
  button.addEventListener("mousedown", stop);
  const open = (event) => {
    stop(event);
    if (typeof onOpen === "function") onOpen(chip.pageUid);
  };
  button.addEventListener("click", open);
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault?.();
    open(event);
  });
  return button;
}
