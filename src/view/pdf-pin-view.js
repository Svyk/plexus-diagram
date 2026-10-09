// In-place plexus-pin (kind pdf). Hover stays Roam's. A click opens the popover. The crop
// loads only after the pin intersects the viewport, and never for a .enc URL.

import { placeNearAnchor } from "./avoid.js";
import { CROP_MAX_H, claimRegionButton, cropFrame } from "./region-crop.js";
import { pinClickMode, pinPdfUrl, sourceAttrString } from "../model/pdf-pin.js";

const POP_MAX = 280;

function showButton(button) {
  if (!button) return;
  if (button.getAttribute?.("data-plexus-owner") === "plexus-diagram") button.removeAttribute("data-plexus-owner");
  if (button.style) button.style.display = "";
}

function stop(event) {
  event.preventDefault?.();
  event.stopPropagation?.();
}

export function buildPinChip(doc, { pinUid, label = "Source" } = {}, onOpen) {
  if (!pinUid || typeof doc?.createElement !== "function") return null;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "pxd-chip pxd-chip--source";
  button.textContent = label;
  button.setAttribute("data-pin", pinUid);
  button.setAttribute("aria-label", "Open source");
  const halt = (event) => event.stopPropagation?.();
  button.addEventListener("pointerdown", halt);
  button.addEventListener("mousedown", halt);
  button.addEventListener("click", (event) => {
    halt(event);
    event.preventDefault?.();
    if (typeof onOpen === "function") onOpen(pinUid, event);
  });
  return button;
}

function paintCrop(doc, frame, src, frac, maxH) {
  if (!src) return;
  const img = doc.createElement("img");
  img.alt = "";
  img.className = "pxd-pdf-pin__img";
  img.addEventListener("load", () => {
    const box = cropFrame(frac, img.naturalWidth || img.width, img.naturalHeight || img.height, maxH);
    if (!box) return;
    frame.style.width = `${box.frameW}px`;
    frame.style.height = `${box.frameH}px`;
    img.style.width = `${box.imgW}px`;
    img.style.height = `${box.imgH}px`;
    img.style.left = `${box.left}px`;
    img.style.top = `${box.top}px`;
  });
  img.src = src;
  frame.append(img);
}

export function openPinPopover({
  doc = globalThis.document,
  anchor = null,
  region = null,
  quote = "",
  surrounding = "",
  crop = "",
  boards = [],
  onOpen = null,
  onCopy = null,
  root = null,
} = {}) {
  const noop = { el: null, close() {} };
  if (!doc?.createElement || !region) return noop;
  const pop = doc.createElement("div");
  pop.className = "pxd-pin-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Source pin");
  const frame = doc.createElement("div");
  frame.className = "pxd-pdf-pin__frame pxd-pdf-pin__frame--pop";
  pop.append(frame);
  if (crop) paintCrop(doc, frame, crop, region.f, POP_MAX);
  else {
    const page = doc.createElement("div");
    page.className = "pxd-pdf-pin__page";
    page.textContent = `p. ${region.pg}`;
    frame.append(page);
  }
  const said = doc.createElement("p");
  said.className = "pxd-pin-pop__quote";
  said.textContent = quote || region.caption || "";
  pop.append(said);
  if (surrounding) {
    const more = doc.createElement("p");
    more.className = "pxd-pin-pop__around";
    more.textContent = surrounding;
    pop.append(more);
  }
  const row = doc.createElement("div");
  row.className = "pxd-pin-pop__acts";
  const add = (label, run) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxd-pin-pop__act";
    button.textContent = label;
    button.addEventListener("click", (event) => { stop(event); run(event); });
    row.append(button);
    return button;
  };
  add("Open in reader", () => onOpen?.({ mode: "main", region }));
  add("Sidebar", () => onOpen?.({ mode: "sidebar", region }));
  const boardBtn = add("Boards", () => {
    let list = pop.querySelector(".pxd-pin-pop__boards");
    if (list) { list.hidden = !list.hidden; return; }
    list = doc.createElement("div");
    list.className = "pxd-pin-pop__boards";
    const rows = Array.isArray(boards) ? boards : [];
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.textContent = "No boards";
      list.append(empty);
    } else {
      for (const board of rows) {
        const item = doc.createElement("button");
        item.type = "button";
        item.className = "pxd-pin-pop__board";
        item.textContent = board.title || board.uid || "Board";
        item.addEventListener("click", (event) => { stop(event); onOpen?.({ mode: "board", region, board }); });
        list.append(item);
      }
    }
    pop.append(list);
  });
  boardBtn.setAttribute("data-boards", String(Array.isArray(boards) ? boards.length : 0));
  add("Copy ref", () => {
    const text = region.uid ? sourceAttrString(region.uid).replace(/^Source::\s*/, "") : "";
    onCopy?.(text || (region.uid ? `((${region.uid}))` : ""));
  });
  pop.append(row);
  const host = root || doc.body || doc.documentElement;
  host?.append?.(pop);
  if (anchor?.getBoundingClientRect && root) {
    try { placeNearAnchor(pop, anchor.getBoundingClientRect(), root, { gap: 6 }); } catch { /* fixed fallback */ }
  }
  if (!pop.style.left) {
    const rect = anchor?.getBoundingClientRect?.();
    pop.style.position = "fixed";
    pop.style.left = `${rect?.left || 8}px`;
    pop.style.top = `${(rect?.bottom || 8) + 6}px`;
  }
  const close = () => { try { pop.remove(); } catch { /* gone */ } };
  return { el: pop, close };
}

export function mountPdfPin({
  doc = globalThis.document,
  button = null,
  region = null,
  loadCrop = null,
  onOpen = null,
  surrounding = "",
  boardsOf = null,
  writeText = null,
  root = null,
} = {}) {
  const noop = { el: null, destroy() {}, loads: () => 0 };
  if (!region || region.kind !== "pdf" || !claimRegionButton(button)) return noop;
  const parent = button.parentElement;
  if (!parent || !doc?.createElement) { showButton(button); return noop; }
  const span = doc.createElement("span");
  span.className = "pxd-pdf-pin";
  span.setAttribute("data-pin", region.uid || "");
  const frame = doc.createElement("span");
  frame.className = "pxd-pdf-pin__frame";
  const quote = doc.createElement("span");
  quote.className = "pxd-pdf-pin__quote";
  quote.textContent = region.caption || "";
  const page = doc.createElement("span");
  page.className = "pxd-pdf-pin__page";
  page.textContent = `p. ${region.pg}`;
  span.append(frame, quote, page);
  if (button.nextSibling) parent.insertBefore(span, button.nextSibling);
  else parent.append(span);
  let loads = 0;
  let pop = null;
  const ask = () => {
    if (loads) return;
    const url = pinPdfUrl(region.url || "");
    if (!url || typeof loadCrop !== "function") return;
    loads += 1;
    Promise.resolve(loadCrop({ url, page: region.pg, frac: region.f })).then((src) => {
      if (!src || span.isConnected === false) return;
      paintCrop(doc, frame, src, region.f, CROP_MAX_H);
    }).catch(() => {});
  };
  const IO = doc.defaultView?.IntersectionObserver || globalThis.IntersectionObserver;
  let observer = null;
  if (typeof IO === "function") {
    try {
      observer = new IO((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) ask();
      });
      observer.observe(span);
    } catch { observer = null; }
  }
  const open = async (event) => {
    stop(event);
    const mode = pinClickMode(event);
    if (mode !== "popover") { onOpen?.({ mode, region }); return; }
    try { pop?.close(); } catch { /* gone */ }
    let boards = [];
    try { boards = (await boardsOf?.(region.uid)) || []; } catch { boards = []; }
    if (span.isConnected === false) return;
    pop = openPinPopover({
      doc,
      anchor: span,
      region,
      quote: region.caption || "",
      surrounding: typeof surrounding === "function" ? surrounding(region) : surrounding,
      crop: frame.querySelector?.("img")?.src || "",
      boards,
      root: root || doc.body,
      onOpen: (info) => onOpen?.(info),
      onCopy: (text) => { if (typeof writeText === "function") writeText(text); },
    });
  };
  span.addEventListener("click", (event) => { void open(event); });
  return {
    el: span,
    loads: () => loads,
    destroy() {
      try { observer?.disconnect(); } catch { /* gone */ }
      try { pop?.close(); } catch { /* gone */ }
      try { span.remove(); } catch { /* gone */ }
      showButton(button);
    },
  };
}
