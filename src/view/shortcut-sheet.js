import { SHORTCUTS } from "./shortcuts.js";

export function createShortcutSheet({ doc = globalThis.document, root, shortcuts = SHORTCUTS } = {}) {
  let sheet = null;
  const close = () => {
    sheet?.remove();
    sheet = null;
  };
  const open = () => {
    if (sheet) return;
    sheet = doc.createElement("div");
    sheet.className = "pxd-sheet pxd-chrome";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Shortcuts");
    const head = doc.createElement("div");
    head.className = "pxd-sheet__head";
    const title = doc.createElement("div");
    title.className = "pxd-sheet__title";
    title.textContent = "Shortcuts";
    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pxd-btn pxd-sheet__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    head.append(title, closeBtn);
    const grid = doc.createElement("div");
    grid.className = "pxd-sheet__grid";
    let groupEl = null;
    let groupName = "";
    for (const row of shortcuts) {
      if (row.group !== groupName) {
        groupName = row.group;
        groupEl = doc.createElement("section");
        groupEl.className = "pxd-sheet__group";
        const heading = doc.createElement("h2");
        heading.className = "pxd-sheet__group-title";
        heading.textContent = row.group;
        groupEl.append(heading);
        grid.append(groupEl);
      }
      const line = doc.createElement("div");
      line.className = "pxd-sheet__row";
      const keys = doc.createElement("span");
      keys.className = "pxd-sheet__keys";
      keys.textContent = row.keys;
      const label = doc.createElement("span");
      label.className = "pxd-sheet__label";
      label.textContent = row.label;
      line.append(keys, label);
      groupEl.append(line);
    }
    sheet.append(head, grid);
    sheet.addEventListener("pointerdown", (event) => event.stopPropagation());
    sheet.addEventListener("keydown", (event) => event.stopPropagation());
    root.append(sheet);
    try { closeBtn.focus({ preventScroll: true }); } catch { closeBtn.focus?.(); }
  };
  return {
    open,
    close,
    toggle() { if (sheet) close(); else open(); },
    isOpen: () => Boolean(sheet),
  };
}
