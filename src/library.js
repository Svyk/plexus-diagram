export function createLibrarySidebar({ extensionAPI, lifecycle, settings, session, onPlacePage }) {
  const list = document.createElement("div");
  list.className = "pxd-library";

  const render = async () => {
    list.innerHTML = "";
    const includeDailies = settings.get("library-include-dailies");
    const query = includeDailies
      ? `[:find ?title :where [?p :node/title ?title]]`
      : `[:find ?title :where [?p :node/title ?title] (not [(clojure.string/includes? ?title " ")])]`;
    let titles = [];
    try {
      titles = (extensionAPI.q?.(query) || []).map((row) => row[0]).filter(Boolean);
    } catch {
      titles = [];
    }
    titles = titles.slice(0, 50);
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

  const windowConfig = {
    label: "Plexus Library",
    icon: "diagram-tree",
    content: list,
  };

  let removeWindow = null;
  if (extensionAPI.ui?.rightSidebar?.addWindow) {
    extensionAPI.ui.rightSidebar.addWindow(windowConfig).then((remove) => {
      removeWindow = remove;
      lifecycle.add(() => remove?.());
    });
  }

  return {
    refresh: render,
    dispose() {
      removeWindow?.();
      list.remove();
    },
  };
}
