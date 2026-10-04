// REG-6. The Save click calls onSave before any await, so the clipboard write stays in the click.

export function openViewDialog(doc, { caption = "", showCopy = true, onSave, onCancel } = {}) {
  const root = doc.createElement("div");
  root.className = "pxd-view-dialog";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", showCopy ? "Save view" : "Rename view");
  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);
  root.addEventListener("click", stop);

  const card = doc.createElement("form");
  card.className = "pxd-view-dialog__card";
  card.addEventListener("submit", (event) => event.preventDefault());
  root.append(card);

  const label = doc.createElement("label");
  label.textContent = "Name";
  const input = doc.createElement("input");
  input.className = "pxd-input";
  input.type = "text";
  input.value = caption;
  input.setAttribute("aria-label", "View name");
  label.append(input);
  card.append(label);

  let copyBox = null;
  if (showCopy) {
    const copyLabel = doc.createElement("label");
    copyLabel.className = "pxd-view-dialog__copy";
    copyBox = doc.createElement("input");
    copyBox.type = "checkbox";
    copyBox.checked = true;
    copyBox.setAttribute("aria-label", "Copy ref");
    copyLabel.append(copyBox);
    copyLabel.append(doc.createTextNode(" Copy ref"));
    card.append(copyLabel);
  }

  const actions = doc.createElement("div");
  actions.className = "pxd-view-dialog__actions";
  const save = doc.createElement("button");
  save.type = "button";
  save.className = "pxd-btn pxd-view-save";
  save.textContent = "Save";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "pxd-btn pxd-view-cancel";
  cancel.textContent = "Cancel";
  actions.append(save, cancel);
  card.append(actions);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
  };
  const cancelDialog = () => {
    close();
    onCancel?.();
  };
  save.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = { caption: input.value, copy: Boolean(copyBox?.checked) };
    onSave?.(result);
    close();
  });
  cancel.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancelDialog();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelDialog();
  });

  return {
    el: root,
    close,
    focus() {
      try { input.focus(); } catch { /* the stub has no focus */ }
    },
  };
}
