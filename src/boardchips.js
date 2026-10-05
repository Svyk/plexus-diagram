// PDF-7 On board chip. Outline blocks only. Read-only.

export function createBoardChips({ doc = globalThis.document, cache } = {}) {
  const chips = new Set();

  const stop = (event) => {
    event.stopPropagation?.();
    event.preventDefault?.();
  };

  const blocked = (node) => Boolean(node?.closest?.(".rm-pdf-container, .pxd-root"));

  const childWith = (container, className) => {
    for (const child of container.children || []) {
      if (child.classList?.contains(className)) return child;
    }
    return null;
  };

  // Only the block's own text row counts. A highlight inside a child block belongs to that child.
  const ownHighlight = (container) => Boolean(childWith(container, "rm-block-main")?.querySelector?.(".rm-block-highlight-view"));

  const qualifies = (container) => {
    if (!container || container.nodeType !== 1 || blocked(container)) return false;
    const uid = container.getAttribute?.("data-block-uid") || "";
    return Boolean(uid && cache?.hasTarget?.(uid) && ownHighlight(container));
  };

  const attach = (container) => {
    if (!qualifies(container)) return;
    if (childWith(container, "pxd-boardchip")) return;
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.className = "pxd-boardchip";
    chip.textContent = "On board";
    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick", "click"]) {
      chip.addEventListener(type, stop);
    }
    const kids = childWith(container, "rm-block-children");
    if (kids) container.insertBefore(chip, kids);
    else container.append(chip);
    chips.add(chip);
  };

  // A chip stays only while its block is still on a board and still shows a highlight.
  const reconcile = () => {
    for (const chip of [...chips]) {
      if (chip.isConnected === false || !qualifies(chip.parentElement)) {
        chips.delete(chip);
        chip.remove();
      }
    }
  };

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    const found = [];
    if (node.matches?.(".roam-block-container")) found.push(node);
    if (typeof node.querySelectorAll === "function") {
      for (const el of node.querySelectorAll(".roam-block-container")) found.push(el);
    }
    for (const el of found) attach(el);
    reconcile();
  };

  // A board changed: look only at the blocks it holds, and drop chips whose card left.
  const scanUids = (uids) => {
    if (!doc?.querySelectorAll) return;
    for (const uid of uids || []) {
      if (!/^[\w-]+$/.test(String(uid))) continue;
      for (const el of doc.querySelectorAll(`.roam-block-container[data-block-uid="${uid}"]`)) attach(el);
    }
    reconcile();
  };

  const dispose = () => {
    for (const chip of chips) chip.remove();
    chips.clear();
  };

  return { scan, scanUids, dispose, count: () => chips.size };
}
