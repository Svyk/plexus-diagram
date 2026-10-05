// PDF-7 On board chip. Outline blocks only. Read-only.

export function createBoardChips({ doc = globalThis.document, cache } = {}) {
  const chips = new Set();

  const stop = (event) => {
    event.stopPropagation?.();
    event.preventDefault?.();
  };

  const blocked = (node) => Boolean(node?.closest?.(".rm-pdf-container, .pxd-root"));

  const attach = (container) => {
    if (!container || container.nodeType !== 1 || blocked(container)) return;
    const uid = container.getAttribute?.("data-block-uid") || "";
    if (!uid || !cache?.hasTarget?.(uid)) return;
    if (!container.querySelector?.(".rm-block-highlight-view")) return;
    for (const child of container.children || []) {
      if (child.classList?.contains("pxd-boardchip")) return;
    }
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.className = "pxd-boardchip";
    chip.textContent = "On board";
    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick", "click"]) {
      chip.addEventListener(type, stop);
    }
    let kids = null;
    for (const child of container.children || []) {
      if (child.classList?.contains("rm-block-children")) kids = child;
    }
    if (kids) container.insertBefore(chip, kids);
    else container.append(chip);
    chips.add(chip);
  };

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    const found = [];
    if (node.matches?.(".roam-block-container")) found.push(node);
    if (typeof node.querySelectorAll === "function") {
      for (const el of node.querySelectorAll(".roam-block-container")) found.push(el);
    }
    for (const el of found) attach(el);
  };

  const dispose = () => {
    for (const chip of chips) chip.remove();
    chips.clear();
  };

  return { scan, dispose, count: () => chips.size };
}
