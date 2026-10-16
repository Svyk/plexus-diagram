// Roam keeps its zoomed outline. This chip is the way back onto the board,
// the same idea as focusing one cell of a grid: the zoom stays Roam's, and
// the chip opens the board on that card. The button is ours. A Roam node is
// never moved.

// The added node only. A node inside a board returns before any query, so a
// 1,560-card mount does not walk its tree looking for .rm-zoom.
export function addedZoomHost(node) {
  if (!node || node.nodeType !== 1 || typeof node.closest !== "function") return null;
  try { if (node.closest(".pxd-root")) return null; } catch { return null; }
  try {
    if (typeof node.matches === "function" && node.matches(".rm-zoom")) return node;
  } catch { /* selector */ }
  if (typeof node.querySelector !== "function") return null;
  let found = null;
  try { found = node.querySelector(".rm-zoom"); } catch { return null; }
  if (!found) return null;
  try { if (found.closest?.(".pxd-root")) return null; } catch { return null; }
  return found;
}

export function createZoomChip({ doc, readTarget, onOpen } = {}) {
  let button = null;
  let key = "";

  const zoomNode = () => {
    const list = doc?.querySelectorAll?.(".rm-article-wrapper .rm-zoom") || [];
    for (const node of list) {
      try {
        if (node.closest?.(".pxd-root") || node.closest?.(".bp3-portal")) continue;
      } catch { continue; }
      return node;
    }
    return null;
  };

  const drop = () => {
    try { button?.remove(); } catch { /* gone */ }
    button = null;
    key = "";
  };

  const sync = () => {
    const zoom = zoomNode();
    let target = null;
    if (zoom) {
      try { target = readTarget?.() || null; } catch { target = null; }
    }
    if (!zoom || !target?.boardUid || !target?.cardUid) {
      drop();
      return;
    }
    const next = `${target.boardUid}\0${target.cardUid}\0${target.blockUid || ""}`;
    if (button && button.isConnected !== false && button.parentElement === zoom && key === next) return;
    drop();
    const el = doc.createElement("button");
    el.type = "button";
    el.className = "pxd-zoomchip";
    el.textContent = "Open on board";
    const stop = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    };
    el.addEventListener("mousedown", stop);
    el.addEventListener("click", (event) => {
      stop(event);
      try { onOpen?.(target); } catch { /* caller */ }
    });
    try { zoom.append(el); } catch { return; }
    button = el;
    key = next;
  };

  return { sync, drop };
}
