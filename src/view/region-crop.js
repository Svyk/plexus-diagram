// REG-4. One crop beside a region button. The button stays in the DOM so unload can show it again.

export const REGION_SCAN_CAP = 60;
export const CROP_MAX_H = 160;
const URL_CAP = 24;

const urls = new Map();

export function resetCropUrls() {
  for (const row of urls.values()) {
    try { URL.revokeObjectURL(row.url); } catch { /* already revoked */ }
  }
  urls.clear();
}

function takeUrl(key, file) {
  const hit = urls.get(key);
  if (hit) {
    hit.refs += 1;
    urls.delete(key);
    urls.set(key, hit);
    return hit.url;
  }
  const url = URL.createObjectURL(file);
  urls.set(key, { url, refs: 1 });
  while (urls.size > URL_CAP) {
    let victim = null;
    for (const [id, row] of urls) {
      if (row.refs <= 0) { victim = id; break; }
    }
    if (!victim) break;
    const row = urls.get(victim);
    urls.delete(victim);
    try { URL.revokeObjectURL(row.url); } catch { /* already revoked */ }
  }
  return url;
}

function dropUrl(key) {
  const row = urls.get(key);
  if (!row) return;
  row.refs -= 1;
  if (row.refs > 0) return;
  urls.delete(key);
  try { URL.revokeObjectURL(row.url); } catch { /* already revoked */ }
}

function fracParts(frac) {
  if (Array.isArray(frac)) return { rx: frac[0], ry: frac[1], rw: frac[2], rh: frac[3] };
  return frac || {};
}

export function cropFrame(frac, naturalW, naturalH, maxH = CROP_MAX_H) {
  const parts = fracParts(frac);
  const rx = Number(parts.rx);
  const ry = Number(parts.ry);
  const rw = Number(parts.rw);
  const rh = Number(parts.rh);
  if (![rx, ry, rw, rh, naturalW, naturalH, maxH].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (rw <= 0 || rh <= 0 || naturalW <= 0 || naturalH <= 0 || maxH <= 0) return null;
  const scale = Math.min(1, maxH / (rh * naturalH));
  const imgW = naturalW * scale;
  const imgH = naturalH * scale;
  return {
    frameW: rw * naturalW * scale,
    frameH: rh * naturalH * scale,
    imgW,
    imgH,
    left: -rx * imgW,
    top: -ry * imgH,
  };
}

export function regionButtonUid(button) {
  const ref = button?.closest?.(".rm-block-ref[data-uid]");
  const refUid = ref?.getAttribute?.("data-uid");
  if (refUid) return refUid;
  return button?.closest?.(".roam-block-container[data-block-uid]")?.getAttribute?.("data-block-uid") || "";
}

function hideButton(button) {
  button.setAttribute("data-plexus-owner", "plexus-diagram");
  button.style.display = "none";
}

function showButton(button) {
  if (!button) return;
  if (button.getAttribute?.("data-plexus-owner") === "plexus-diagram") button.removeAttribute("data-plexus-owner");
  if (button.style) button.style.display = "";
}

export function claimRegionButton(button) {
  if (!button || button.nodeType !== 1) return false;
  if (button.getAttribute?.("data-plexus-owner")) return false;
  hideButton(button);
  return true;
}

function nextSibling(node) {
  if (node?.nextSibling) return node.nextSibling;
  const kids = node?.parentElement?.children;
  if (!kids) return null;
  const list = typeof kids.indexOf === "function" ? kids : [...kids];
  const at = list.indexOf(node);
  return at >= 0 ? list[at + 1] || null : null;
}

function applyFrame(frame, img, frac, maxH) {
  const box = cropFrame(frac, img.naturalWidth, img.naturalHeight, maxH);
  if (!box) return false;
  frame.style.width = `${box.frameW}px`;
  frame.style.height = `${box.frameH}px`;
  img.style.width = `${box.imgW}px`;
  img.style.height = `${box.imgH}px`;
  img.style.left = `${box.left}px`;
  img.style.top = `${box.top}px`;
  return true;
}

export function mountRegionCrop({ doc = globalThis.document, button, region, file, maxH = CROP_MAX_H } = {}) {
  const noop = { destroy() {} };
  const parent = button?.parentElement;
  if (!doc || !parent || !region) return noop;

  const span = doc.createElement("span");
  span.className = "pxd-region-crop";
  span.style.setProperty("display", "inline-flex", "important");
  span.style.setProperty("max-width", "none", "important");
  span.style.setProperty("vertical-align", "top", "important");
  const caption = doc.createElement("span");
  caption.className = "pxd-region-crop__caption";
  caption.textContent = region.caption || "";

  let key = "";
  const showMissing = () => {
    const miss = doc.createElement("span");
    miss.className = "pxd-region-crop__missing";
    miss.textContent = "image unavailable";
    span.replaceChildren(caption, miss);
  };

  if (!file) showMissing();
  else {
    const frame = doc.createElement("span");
    frame.className = "pxd-region-crop__frame";
    frame.style.setProperty("display", "inline-block", "important");
    frame.style.setProperty("position", "relative", "important");
    frame.style.setProperty("overflow", "hidden", "important");
    frame.style.setProperty("max-width", "none", "important");
    frame.style.setProperty("box-sizing", "border-box", "important");
    const img = doc.createElement("img");
    img.className = "pxd-region-crop__img";
    img.alt = region.caption || "";
    img.draggable = false;
    frame.append(img);
    span.append(frame, caption);
    try {
      key = region.drawingUid || "";
      const cacheKey = key || `crop-${span.id || Math.random()}`;
      key = cacheKey;
      img.src = takeUrl(cacheKey, file);
      const paint = () => applyFrame(frame, img, region.f, maxH);
      if (img.complete && img.naturalWidth) paint();
      else img.addEventListener("load", paint, { once: true });
      img.addEventListener("error", () => { dropUrl(key); key = ""; showMissing(); }, { once: true });
    } catch {
      showMissing();
    }
  }

  parent.insertBefore(span, nextSibling(button));
  let dead = false;
  return {
    el: span,
    destroy() {
      if (dead) return;
      dead = true;
      span.remove();
      if (key) dropUrl(key);
      showButton(button);
    },
  };
}

export function openRegionCrop({ doc, button, region, loadFile, maxH = CROP_MAX_H } = {}) {
  const noop = { destroy() {}, pending: Promise.resolve() };
  if (!claimRegionButton(button)) return noop;
  let handle = null;
  let dead = false;
  const destroy = () => {
    if (dead) return;
    dead = true;
    if (handle) handle.destroy();
    else showButton(button);
  };
  const pending = Promise.resolve()
    .then(() => (typeof loadFile === "function" ? loadFile(region) : null))
    .then((file) => {
      if (dead || button.isConnected === false) {
        if (!dead) showButton(button);
        dead = true;
        return;
      }
      handle = mountRegionCrop({ doc, button, region, file, maxH });
    })
    .catch(() => {
      if (dead || button.isConnected === false) {
        if (!dead) showButton(button);
        dead = true;
        return;
      }
      handle = mountRegionCrop({ doc, button, region, file: null, maxH });
    });
  return { destroy, pending };
}

export function eachRegionButton(root, fn, cap = REGION_SCAN_CAP) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 9) || typeof fn !== "function") return 0;
  const found = [];
  if (root.matches?.("button.rm-xparser-default-plexus-region")) found.push(root);
  if (typeof root.querySelectorAll === "function") {
    found.push(...root.querySelectorAll("button.rm-xparser-default-plexus-region"));
  }
  let seen = 0;
  for (const button of found) {
    if (seen >= cap) break;
    seen += 1;
    if (button.getAttribute?.("data-plexus-owner")) continue;
    fn(button);
  }
  return seen;
}
