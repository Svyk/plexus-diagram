// ECO-3 crop card. Thumbnail runs only at detail while the card is visible.
// The object URL sits on the node so unmount can revoke it. No module map of blobs.

export function thumbRequest(prevWidth, nextWidth) {
  const next = Number(nextWidth);
  if (!Number.isFinite(next) || next <= 0) return false;
  return next !== Number(prevWidth);
}

function releaseThumb(node) {
  const url = node?._pxdObjectUrl;
  if (!url) return;
  node._pxdObjectUrl = "";
  try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
}

function paintThumb(doc, node, blob) {
  const caption = node.querySelector(".pxd-region-caption");
  let img = node.querySelector("img.pxd-region-thumb");
  if (blob == null) {
    releaseThumb(node);
    img?.remove();
    return;
  }
  if (!img) {
    img = doc.createElement("img");
    img.className = "pxd-region-thumb";
    img.alt = "";
    if (caption) node.insertBefore(img, caption);
    else node.append(img);
  }
  if (typeof blob === "string") {
    releaseThumb(node);
    img.src = blob;
    return;
  }
  if (typeof URL.createObjectURL !== "function") return;
  let url = "";
  try { url = URL.createObjectURL(blob); } catch { return; }
  releaseThumb(node);
  node._pxdObjectUrl = url;
  img.src = url;
}

function mountButton(doc, node, className, text, onClick) {
  node.querySelector(`.${className}`)?.remove();
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.setAttribute("type", "button");
  btn.className = className;
  btn.textContent = text;
  btn.setAttribute("aria-label", text);
  const stop = (event) => event.stopPropagation?.();
  btn.addEventListener("pointerdown", stop);
  btn.addEventListener("mousedown", stop);
  btn.addEventListener("click", (event) => {
    stop(event);
    onClick();
  });
  node.append(btn);
}

function wantsThumb(hooks) {
  return hooks?.tier === "detail" && hooks.visible !== false && typeof hooks.thumbnail === "function";
}

export function renderRegionCard(doc, card, model, hooks = {}) {
  const node = card || doc.createElement("div");
  node.classList.add("pxd-item--region");
  let caption = node.querySelector(".pxd-region-caption");
  if (!caption) {
    caption = doc.createElement("div");
    caption.className = "pxd-region-caption";
    node.append(caption);
  }
  caption.textContent = model?.caption ?? "";
  const open = typeof hooks.open === "function" ? hooks.open : () => {};
  if (!node._pxdRegionKeys) {
    node._pxdRegionKeys = true;
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const btn = event.target?.closest?.("button");
      if (!btn || !node.contains(btn)) return;
      event.preventDefault();
      btn.click();
    });
  }
  mountButton(doc, node, "pxd-region-open", "Open drawing", () => open({ sidebar: false }));
  mountButton(doc, node, "pxd-region-sidebar", "Open in sidebar", () => open({ sidebar: true }));
  node.pxdUnmount = () => {
    node._pxdThumbGen = (node._pxdThumbGen || 0) + 1;
    releaseThumb(node);
    node.querySelector("img.pxd-region-thumb")?.remove();
  };
  const gen = (node._pxdThumbGen || 0) + 1;
  node._pxdThumbGen = gen;
  if (!wantsThumb(hooks)) return node;
  let result;
  try {
    result = hooks.thumbnail({ maxWidth: hooks.maxWidth });
  } catch {
    return node;
  }
  const apply = (blob) => {
    if (node._pxdThumbGen !== gen) return;
    paintThumb(doc, node, blob);
  };
  if (result && typeof result.then === "function") result.then(apply, () => {});
  else apply(result);
  return node;
}
