// MEM-4. Panel beside Roam's plexus-resurface button. Unload removes the panel only.

import { matchResurface, pageTitleToDate, parseIntervals } from "../model/resurface.js";
import { drawViewMap } from "./minimap-svg.js";

const EMPTY = "Nothing from a week, a month or a year ago.";
const BUTTON = "button.rm-xparser-default-plexus-resurface";

function thumb(doc, parent, item) {
  const box = doc.createElement("div");
  box.className = "pxd-resurface__thumb";
  const rect = item.rect || { x: 0, y: 0, w: 280, h: 160 };
  drawViewMap(doc, box, {
    viewBox: { x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 },
    cards: [{ uid: item.cardUid || item.uid, rect, title: item.title || "", role: "hi", type: "card" }],
  });
  parent.append(box);
}

function wireResurfaceKeys(panel) {
  if (!panel || panel._pxdResurfaceKeys) return;
  panel._pxdResurfaceKeys = true;
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target?.closest?.(".pxd-resurface__item, .pxd-resurface__tab");
    if (!item || !panel.contains(item)) return;
    event.preventDefault();
    item.click();
  });
}

export function fillResurface(doc, panel, { pageTitle, rows, intervals, onOpen } = {}) {
  if (!panel.getAttribute?.("role")) panel.setAttribute?.("role", "region");
  if (!panel.getAttribute?.("aria-label")) panel.setAttribute?.("aria-label", "Resurface");
  wireResurfaceKeys(panel);
  panel.replaceChildren();
  const pageDate = pageTitleToDate(pageTitle);
  const tabs = matchResurface(rows, pageDate, parseIntervals(intervals));
  if (!tabs.length) {
    const line = doc.createElement("div");
    line.className = "pxd-resurface__empty";
    line.textContent = EMPTY;
    panel.append(line);
    return;
  }
  const bar = doc.createElement("div");
  bar.className = "pxd-resurface__tabs";
  const body = doc.createElement("div");
  body.className = "pxd-resurface__body";
  const show = (tab) => {
    body.replaceChildren();
    for (const item of tab.items) {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "pxd-resurface__item";
      row.textContent = item.title || item.uid;
      row.setAttribute("aria-label", item.title || item.uid || "Open");
      thumb(doc, row, item);
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.({ boardUid: item.boardUid, cardUid: item.cardUid || item.uid });
      });
      body.append(row);
    }
  };
  tabs.forEach((tab, index) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxd-resurface__tab";
    button.textContent = tab.label;
    button.setAttribute("aria-label", tab.label || "Resurface");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      show(tab);
    });
    bar.append(button);
    if (index === 0) show(tab);
  });
  panel.append(bar, body);
}

export function createResurface({ doc, pageTitle, rows, intervals, onOpen } = {}) {
  const panels = new Set();
  let lastSig = "";
  let lastList = null;
  let lastKey = "";
  const prune = () => {
    for (const entry of [...panels]) {
      if (entry.button?.isConnected !== false) continue;
      entry.panel.remove();
      panels.delete(entry);
    }
  };
  const mount = (button) => {
    if (!button || button.dataset?.pxdResurface === "1") return;
    if (button.dataset) button.dataset.pxdResurface = "1";
    const panel = doc.createElement("div");
    panel.className = "pxd-resurface pxd-root";
    fillResurface(doc, panel, { pageTitle: pageTitle?.(), rows: rows?.() || [], intervals: intervals?.(), onOpen });
    if (typeof button.insertAdjacentElement === "function") button.insertAdjacentElement("afterend", panel);
    else button.parentElement?.append(panel);
    panels.add({ button, panel });
  };
  return {
    scan(node) {
      // A refill replaces the panel's children. Those mutations must not scan again.
      if (node?.closest?.(".pxd-resurface")) return;
      prune();
      const root = node?.querySelectorAll ? node : doc;
      const buttons = root?.querySelectorAll?.(BUTTON) || [];
      for (const button of buttons) mount(button);
      // No button and no panel: nothing to show, and no card rows to read.
      if (!panels.size) {
        lastSig = "";
        lastList = null;
        return;
      }
      const list = rows?.() || [];
      const key = `${pageTitle?.() || ""}\n${intervals?.() || ""}`;
      if (list === lastList && key === lastKey) return;
      lastList = list;
      lastKey = key;
      const sig = `${pageTitle?.() || ""}\n${intervals?.() || ""}\n${list.map((row) => `${row.uid}:${row.time}`).join(",")}`;
      if (sig === lastSig) return;
      lastSig = sig;
      const spec = { pageTitle: pageTitle?.(), rows: list, intervals: intervals?.(), onOpen };
      for (const { button, panel } of panels) {
        if (button?.isConnected) fillResurface(doc, panel, spec);
      }
    },
    dispose() {
      for (const { button, panel } of panels) {
        panel.remove();
        if (button?.dataset) delete button.dataset.pxdResurface;
      }
      panels.clear();
      lastSig = "";
      lastList = null;
    },
  };
}
