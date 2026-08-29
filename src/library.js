export function filterLibraryTitles(titles, query) {
  const q = String(query || "").trim().toLowerCase();
  const roamJs = /^roam\/js\//;
  const roamCss = /^roam\/css/;
  return (titles || [])
    .filter((title) => title && String(title).trim())
    .filter((title) => {
      const text = String(title);
      if (!q && (roamJs.test(text) || roamCss.test(text))) return false;
      if (q && !text.toLowerCase().includes(q)) return false;
      return true;
    })
    .slice(0, 30);
}

export function placeLibraryDrawer(drawer, root = globalThis.document) {
  if (!drawer?.style) return;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  const rect = toolbar?.getBoundingClientRect?.();
  const overlay = root?.querySelector?.(".pxd-mount--fullscreen") || root?.querySelector?.(".pxd-mount");
  const overlayRect = overlay?.getBoundingClientRect?.();
  const view = root?.defaultView || globalThis;
  const vw = Number(view.innerWidth);
  let overlayRight = 0;
  if (overlayRect && Number.isFinite(Number(overlayRect.right)) && Number.isFinite(vw) && vw > 0) {
    overlayRight = Math.max(0, vw - overlayRect.right);
  }
  drawer.style.position = "fixed";
  drawer.style.top = rect && Number.isFinite(Number(rect.top)) ? `${Math.round(rect.top)}px` : "56px";
  drawer.style.right = `${Math.max(16, overlayRight + 16)}px`;
  drawer.style.left = "auto";
}

export function createLibrarySidebar({ lifecycle, settings, session, onPlacePage, mountRoot, onClose }) {
  const parent = (typeof document !== "undefined" && document.body) || mountRoot;
  parent.querySelector?.(".pxd-library-drawer")?.remove();

  const drawer = document.createElement("div");
  drawer.className = "pxd-library-drawer";

  const header = document.createElement("div");
  header.className = "pxd-library-drawer__header";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "pxd-library-drawer__search";
  search.placeholder = "Search pages…";
  search.setAttribute("aria-label", "Search library pages");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pxd-library-drawer__close";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close library");

  header.append(search, closeBtn);

  const list = document.createElement("div");
  list.className = "pxd-library";
  drawer.append(header, list);
  lifecycle.node(drawer, parent);
  placeLibraryDrawer(drawer);

  let titles = [];

  const close = () => {
    drawer.remove();
    onClose?.();
  };
  closeBtn.addEventListener("click", close);

  const renderList = () => {
    list.innerHTML = "";
    const filtered = filterLibraryTitles(titles, search.value);
    for (const title of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pxd-library__item";
      row.textContent = title;
      row.addEventListener("click", () => onPlacePage(title));
      list.append(row);
    }
  };

  const loadTitles = async () => {
    const includeDailies = settings.get("library-include-dailies");
    const query = "[:find ?title ?uid :where [?p :node/title ?title] [?p :block/uid ?uid]]";
    let rows = [];
    try {
      rows = globalThis.roamAlphaAPI?.data?.q?.(query) || [];
    } catch {
      rows = [];
    }
    const dailyPattern = /^\d{2}-\d{2}-\d{4}$/;
    titles = rows
      .filter(([, pageUid]) => includeDailies || !dailyPattern.test(String(pageUid ?? "")))
      .map(([title]) => title)
      .filter((title) => title && String(title).trim());
    renderList();
  };

  search.addEventListener("input", renderList);
  void loadTitles();

  return {
    refresh: loadTitles,
    isOpen: () => drawer.isConnected,
    close,
    dispose() {
      drawer.remove();
    },
  };
}
