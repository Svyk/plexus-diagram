// The dry run for "Move PDFs to their own pages": what will move, then Move or Cancel. No writes here.

export function openPdfPagesDialog(doc, { count = 0, lines = [], onApply, onCancel } = {}) {
  const root = doc.createElement("div");
  root.className = "pxd-view-dialog pxd-pdf-pages";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Move PDFs to their own pages");
  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);
  root.addEventListener("click", stop);
  root.addEventListener("wheel", stop);

  const card = doc.createElement("form");
  card.className = "pxd-view-dialog__card";
  card.addEventListener("submit", (event) => event.preventDefault());
  root.append(card);

  const head = doc.createElement("p");
  head.className = "pxd-pdf-pages__head";
  head.textContent = `Move ${count} ${count === 1 ? "PDF" : "PDFs"} on this board to ${count === 1 ? "its own page" : "their own pages"}? `
    + "Each card becomes a link to the page. Highlights, pins and reads stay with the PDF.";
  card.append(head);

  const list = doc.createElement("ul");
  list.className = "pxd-pdf-pages__list";
  for (const line of lines) {
    const li = doc.createElement("li");
    li.textContent = String(line);
    list.append(li);
  }
  card.append(list);

  const actions = doc.createElement("div");
  actions.className = "pxd-view-dialog__actions";
  const button = (cls, label, run) => {
    const node = doc.createElement("button");
    node.type = "button";
    node.className = `pxd-btn ${cls}`;
    node.textContent = label;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      run?.();
    });
    return node;
  };
  const cancel = button("pxd-pdf-pages-cancel", "Cancel", onCancel);
  actions.append(button("pxd-pdf-pages-apply", "Move", onApply), cancel);
  card.append(actions);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
  };
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel?.();
  });

  return {
    el: root,
    close,
    cancel() { onCancel?.(); },
    focus() {
      try { cancel.focus(); } catch { /* the stub has no focus */ }
    },
  };
}
