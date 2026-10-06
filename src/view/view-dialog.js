// REG-6. The Save click calls onSave before any await, so the clipboard write stays in the click.

function focusEl(el) {
  if (!el || typeof el.focus !== "function" || el.isConnected === false) return;
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* gone */ } }
}

export function openViewDialog(doc, { caption = "", showCopy = true, dialogLabel = "", onSave, onCancel } = {}) {
  const root = doc.createElement("div");
  root.className = "pxd-view-dialog";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", dialogLabel || (showCopy ? "Save view" : "Rename view"));
  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);
  root.addEventListener("click", stop);

  const card = doc.createElement("form");
  card.className = "pxd-view-dialog__card";
  card.addEventListener("submit", (event) => event.preventDefault());
  root.append(card);

  const glyph = dialogLabel === "Landmark glyph";
  const label = doc.createElement("label");
  label.textContent = glyph ? "Glyph" : "Name";
  const input = doc.createElement("input");
  input.className = "pxd-input";
  input.type = "text";
  input.value = caption;
  input.setAttribute("aria-label", glyph ? "Landmark glyph" : "View name");
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
  save.setAttribute("aria-label", "Save");
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "pxd-btn pxd-view-cancel";
  cancel.textContent = "Cancel";
  cancel.setAttribute("aria-label", "Cancel");
  actions.append(save, cancel);
  card.append(actions);

  let closed = false;
  let opener = null;
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
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const back = opener;
      cancelDialog();
      focusEl(back);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (String(event.target?.tagName || "").toLowerCase() === "textarea") return;
    event.preventDefault();
    event.stopPropagation();
    save.click();
  });

  return {
    el: root,
    close,
    focus() {
      const cur = doc.activeElement;
      if (cur && cur !== doc.body && cur !== doc.documentElement && !root.contains(cur)) opener = cur;
      try { input.focus(); } catch { /* the stub has no focus */ }
    },
  };
}
