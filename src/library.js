export function createLibrarySidebar({ lifecycle, settings, session, onPlacePage, mountRoot }) {
  const parent = mountRoot || document.body;
  parent.querySelector(".pxd-library-drawer")?.remove();

  const drawer = document.createElement("div");
  drawer.className = "pxd-library-drawer";
  const list = document.createElement("div");
  list.className = "pxd-library";
  drawer.append(list);
  lifecycle.node(drawer, parent);

  const render = async () => {
    list.innerHTML = "";
    const includeDailies = settings.get("library-include-dailies");
    const query = `[:find ?title ?uid :where [?p :node/title ?title] [?p :block/uid ?uid]]`;
    let rows = [];
    try {
      rows = globalThis.roamAlphaAPI?.data?.q?.(query) || [];
    } catch {
      rows = [];
    }
    const dailyPattern = /^\d{2}-\d{2}-\d{4}$/;
    const titles = rows
      .filter(([, pageUid]) => includeDailies || !dailyPattern.test(String(pageUid ?? "")))
      .map(([title]) => title)
      .filter(Boolean)
      .slice(0, 50);
    for (const title of titles) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pxd-library__item";
      row.textContent = title;
      row.addEventListener("click", () => onPlacePage(title));
      list.append(row);
    }
  };

  void render();

  return {
    refresh: render,
    dispose() {
      drawer.remove();
    },
  };
}
