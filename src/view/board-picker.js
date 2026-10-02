// "Add to board…" picker. Lives on document.body, outside .pxd-root, so a block context menu
// on any page can place a ref without a board already focused. One open picker at a time.

export function recentBoardRows(rows) {
  return [...(rows || [])]
    .filter((row) => row && row.uid)
    .sort((a, b) => (Number(b.edited) || 0) - (Number(a.edited) || 0) || String(a.title || "").localeCompare(String(b.title || "")));
}

let current = null;

export function openAddToBoard({ doc = globalThis.document, listBoards, onPick } = {}) {
  current?.close();
  const offs = [];
  const on = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };

  const back = el("div", "pxd-addboard-back", doc.body);
  const box = el("div", "pxd-addboard", doc.body);
  el("div", "pxd-addboard__title", box, "Add to board");
  const filter = el("input", "pxd-addboard__filter", box);
  filter.type = "text";
  filter.placeholder = "Filter boards…";
  filter.setAttribute("placeholder", "Filter boards…");
  const list = el("div", "pxd-addboard__list", box);
  el("div", "pxd-addboard__empty", list, "Loading boards…");

  let rows = [];
  let closed = false;
  let busy = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (current === api) current = null;
    for (const off of offs) off();
    back.remove();
    box.remove();
  };
  const api = { close };
  current = api;

  const render = () => {
    list.replaceChildren();
    const q = String(filter.value || "").trim().toLowerCase();
    const shown = rows.filter((b) => !q || `${b.title || ""}\n${b.pageTitle || b.page || ""}`.toLowerCase().includes(q));
    if (!shown.length) {
      el("div", "pxd-addboard__empty", list, rows.length ? "No matching boards" : "No boards found");
      return;
    }
    for (const b of shown) {
      const row = el("div", "pxd-addboard__row", list);
      row.dataset.uid = b.uid;
      row.setAttribute("data-uid", b.uid);
      const text = el("span", "pxd-addboard__text", row);
      el("span", "pxd-addboard__name", text, b.title || "Untitled board");
      const page = b.pageTitle || b.page;
      if (page) el("span", "pxd-addboard__page", text, page);
    }
  };

  on(box, "pxd-close", () => close());
  on(back, "pointerdown", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    close();
  });
  on(filter, "input", () => render());
  on(filter, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key !== "Escape") return;
    event.preventDefault?.();
    close();
  });
  on(list, "click", (event) => {
    const row = event.target?.closest?.(".pxd-addboard__row");
    const uid = row?.dataset?.uid || row?.getAttribute?.("data-uid");
    if (!uid || busy) return;
    const board = rows.find((b) => b.uid === uid);
    if (!board) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    busy = true;
    Promise.resolve(onPick?.(board)).then((ok) => {
      if (ok === false) { busy = false; return; }
      close();
    }, () => { busy = false; });
  });

  Promise.resolve(typeof listBoards === "function" ? listBoards() : []).then((got) => {
    if (closed) return;
    rows = recentBoardRows(got);
    render();
  }, () => {
    if (closed) return;
    rows = [];
    render();
  });
  try { filter.focus(); } catch { /* the host has no focus */ }
  return api;
}
