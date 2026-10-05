// ECO-4 drawing card. Detail paints hooks.blob. The image click does not open.
// Pixel copy keeps the picture after the hidden src is revoked. No graph write.

function pixelSize(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function releaseThumb(node) {
  const url = node?._pxdObjectUrl;
  if (!url) return;
  node._pxdObjectUrl = "";
  try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
}

function stop(event) {
  event.stopPropagation?.();
}

function onPress(el, fn) {
  el.addEventListener("pointerdown", stop);
  el.addEventListener("mousedown", stop);
  el.addEventListener("click", (event) => {
    stop(event);
    fn();
  });
}

function mountButton(doc, node, className, text, fn) {
  node.querySelector(`.${className}`)?.remove();
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.setAttribute("type", "button");
  btn.className = className;
  btn.textContent = text;
  onPress(btn, fn);
  node.append(btn);
  return btn;
}

function showThumb(hooks) {
  if (hooks?.tier !== "detail" || hooks.visible === false) return false;
  const blob = hooks.blob;
  if (typeof blob === "string") return blob.length > 0;
  return blob != null && typeof blob === "object";
}

function paintThumb(doc, node, blob) {
  let img = node.querySelector("img.pxd-drawing-thumb");
  if (!img) {
    img = doc.createElement("img");
    img.className = "pxd-drawing-thumb";
    img.alt = "";
    const title = node.querySelector(".pxd-drawing-title");
    if (title) node.insertBefore(img, title);
    else node.prepend(img);
    onPress(img, () => {});
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

function clearThumb(node) {
  releaseThumb(node);
  node.querySelector("img.pxd-drawing-thumb")?.remove();
}

function paintRegions(doc, node, bar, hooks) {
  const wasOpen = node.querySelector(".pxd-drawing-region-list")?.classList.contains("is-open") === true;
  node.querySelector(".pxd-drawing-regions")?.remove();
  node.querySelector(".pxd-drawing-region-list")?.remove();
  if (!Array.isArray(hooks?.regions)) {
    node.classList.remove("is-regions");
    return;
  }
  const list = doc.createElement("div");
  list.className = "pxd-drawing-region-list";
  if (wasOpen) list.classList.add("is-open");
  const add = typeof hooks.addRegion === "function" ? hooks.addRegion : () => {};
  for (const region of hooks.regions) {
    const row = doc.createElement("button");
    row.type = "button";
    row.setAttribute("type", "button");
    row.className = "pxd-drawing-region";
    const uid = region?.uid;
    if (uid != null) row.setAttribute("data-uid", String(uid));
    row.textContent = String(region?.caption ?? "");
    onPress(row, () => { add(uid); });
    list.append(row);
  }
  node.append(list);
  node.classList.toggle("is-regions", wasOpen);
  mountButton(doc, bar, "pxd-drawing-regions", "Regions", () => {
    const open = list.classList.toggle("is-open");
    node.classList.toggle("is-regions", open);
  });
}

export function renderDrawingCard(doc, node, model, hooks = {}) {
  const el = node || doc.createElement("div");
  el.classList.add("pxd-item--drawing");
  let title = el.querySelector(".pxd-drawing-title");
  if (!title) {
    title = doc.createElement("div");
    title.className = "pxd-drawing-title";
    el.append(title);
  }
  title.textContent = String(model?.title ?? model?.caption ?? "");
  let bar = el.querySelector(".pxd-drawing-bar");
  if (!bar) {
    bar = doc.createElement("div");
    bar.className = "pxd-drawing-bar";
    el.append(bar);
  }
  const open = typeof hooks.open === "function" ? hooks.open : () => {};
  mountButton(doc, bar, "pxd-drawing-open", "Open drawing", () => open({ sidebar: false }));
  mountButton(doc, bar, "pxd-drawing-sidebar", "Open in sidebar", () => open({ sidebar: true }));
  paintRegions(doc, el, bar, hooks);
  el.pxdUnmount = () => { clearThumb(el); };
  if (!showThumb(hooks)) {
    clearThumb(el);
    return el;
  }
  paintThumb(doc, el, hooks.blob);
  return el;
}

export function copyDrawingPixels(img, doc) {
  const canvas = doc.createElement("canvas");
  const w = pixelSize(img?.naturalWidth) || pixelSize(img?.width);
  const h = pixelSize(img?.naturalHeight) || pixelSize(img?.height);
  canvas.width = w;
  canvas.height = h;
  let ctx = null;
  try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
  if (ctx && typeof ctx.drawImage === "function") {
    if (w > 0 && h > 0) ctx.drawImage(img, 0, 0, w, h);
    else ctx.drawImage(img, 0, 0);
  }
  return canvas;
}
