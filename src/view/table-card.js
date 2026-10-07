// Host for one Roam table inside a card. The live block is renderBlock, never a
// flattened child list. The grid renders in world units and scales with the
// board like any card body (Roam Grid divides pointer deltas by the ancestor's
// scale). Open grid mounts a second render at 100% on .pxd-root, outside the
// transformed .pxd-world, as the editing surface.

function drawBlock(renderBlock, el, uid) {
  if (typeof renderBlock !== "function" || !el) return;
  try { renderBlock(el, uid); } catch { /* Roam declined this block */ }
}

export function mountRoamTable(doc, parent, { uid, renderBlock, portalParent, unmount } = {}) {
  const host = doc.createElement("div");
  host.className = "pxd-roam-table pxd-rs";
  if (uid) host.setAttribute("data-pxd-table", String(uid));
  const bar = doc.createElement("div");
  bar.className = "pxd-roam-table__bar";
  const open = doc.createElement("button");
  open.type = "button";
  open.className = "pxd-roam-table__open";
  open.setAttribute("aria-label", "Open grid");
  open.textContent = "Open grid";
  bar.append(open);
  const fit = doc.createElement("div");
  fit.className = "pxd-roam-table__fit";
  const live = doc.createElement("div");
  live.className = "pxd-rs__live";
  fit.append(live);
  host.append(bar, fit);
  parent?.append?.(host);

  const rec = { host, grid: false, overlay: null };
  drawBlock(renderBlock, live, uid);

  const seeGrid = () => Boolean(live.querySelector?.("[data-roam-grid-uid], .rg-root"));
  const syncGrid = () => {
    rec.grid = seeGrid();
    host.classList.toggle("pxd-roam-table--grid", rec.grid);
  };

  const view = doc.defaultView || globalThis.window || globalThis;
  const Obs = view.MutationObserver || globalThis.MutationObserver;
  let mo = null;
  if (typeof Obs === "function") {
    mo = new Obs(() => syncGrid());
    try { mo.observe(live, { childList: true, subtree: true, attributes: true }); } catch { /* stub */ }
  }
  syncGrid();

  const portalRoot = () => {
    const given = portalParent && !portalParent.classList?.contains?.("pxd-world") ? portalParent : null;
    if (given) return given;
    const found = parent?.closest?.(".pxd-root");
    if (found && !found.classList?.contains?.("pxd-world")) return found;
    return doc.body || parent;
  };

  const closeOverlay = () => {
    const overlay = rec.overlay;
    if (!overlay) return;
    rec.overlay = null;
    const stage = overlay.querySelector?.(".pxd-table-overlay__stage");
    try { unmount?.(stage); } catch { /* not a roam root */ }
    try { overlay.remove(); } catch { /* already gone */ }
  };

  const openOverlay = () => {
    if (rec.overlay) return;
    const overlay = doc.createElement("div");
    overlay.className = "pxd-table-overlay";
    if (uid) overlay.setAttribute("data-pxd-table", String(uid));
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "pxd-table-overlay__close";
    close.setAttribute("aria-label", "Close grid");
    close.textContent = "Close";
    const stage = doc.createElement("div");
    stage.className = "pxd-table-overlay__stage pxd-rs__live";
    overlay.append(close, stage);
    portalRoot()?.append?.(overlay);
    rec.overlay = overlay;
    drawBlock(renderBlock, stage, uid);
    close.addEventListener("pointerdown", (event) => { event.stopPropagation(); });
    close.addEventListener("click", (event) => { event.stopPropagation(); closeOverlay(); });
  };

  open.addEventListener("pointerdown", (event) => { event.stopPropagation(); });
  open.addEventListener("click", (event) => { event.stopPropagation(); openOverlay(); });

  const onKey = (event) => {
    if (event.key !== "Escape" || !rec.overlay) return;
    const field = event.target?.closest?.("input, textarea, [contenteditable=\"true\"], [contenteditable=\"\"]");
    if (field && rec.overlay.contains?.(field)) return;
    closeOverlay();
    event.stopPropagation();
  };
  view.addEventListener?.("keydown", onKey, true);

  host.__pxdEmbedMo = {
    disconnect() {
      try { mo?.disconnect(); } catch { /* already off */ }
      mo = null;
      try { view.removeEventListener?.("keydown", onKey, true); } catch { /* already off */ }
      closeOverlay();
    },
  };
  return host;
}
