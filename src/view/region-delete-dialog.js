// REG-8. Three buttons, because a native confirm cannot open the references.

export function openRegionDeleteDialog(doc, { message = "", onDelete, onOpen, onCancel } = {}) {
  const root = doc.createElement("div");
  root.className = "pxd-view-dialog";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Delete region");
  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);
  root.addEventListener("click", stop);

  const card = doc.createElement("form");
  card.className = "pxd-view-dialog__card";
  card.addEventListener("submit", (event) => event.preventDefault());
  root.append(card);

  const text = doc.createElement("p");
  text.className = "pxd-region-delete__message";
  text.textContent = message;
  card.append(text);

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
  const cancel = button("pxd-region-delete-cancel", "Cancel", onCancel);
  actions.append(
    button("pxd-region-delete", "Delete", onDelete),
    button("pxd-region-open-refs", "Open references", onOpen),
    cancel,
  );
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
    // The safe choice takes focus once the dialog is in the tree, so Escape and Enter reach it.
    focus() {
      try { cancel.focus(); } catch { /* the stub has no focus */ }
    },
  };
}
