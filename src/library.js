export function filterLibraryTitles(titles, query) {
  const q = String(query || "").trim().toLowerCase();
  const roamJs = /^roam\/js\//;
  return (titles || [])
    .filter((title) => title && String(title).trim())
    .filter((title) => {
      const text = String(title);
      if (!q && roamJs.test(text)) return false;
      if (q && !text.toLowerCase().includes(q)) return false;
      return true;
    })
    .slice(0, 30);
}

export function createLibrarySidebar({ lifecycle, settings, session, onPlacePage, mountRoot, onClose }) {
  const parent = mountRoot || document.body;
  parent.querySelector(".pxd-library-drawer")?.remove();

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
