// Gallery, timeline, and derived-link graph. Read-only overlays. Nothing here writes the graph.

import { cardLabel, derivedGraph, galleryGrid, galleryItems, graphLayout, printPages, timelineAxis } from "../model/section6.js";

const TITLES = { gallery: "Gallery", timeline: "Timeline", graph: "Graph" };

const SVG_NS = "http://www.w3.org/2000/svg";

export function mountLater({ doc = globalThis.document, root, host, getBoard, onClose } = {}) {
  const resolve = (uid) => host?.blockString?.(uid);
  const box = doc.createElement("div");
  box.className = "pxd-later pxd-chrome";
  box.hidden = true;
  root?.append(box);
  const bar = doc.createElement("div");
  bar.className = "pxd-later__bar";
  const title = doc.createElement("span");
  title.className = "pxd-later__title";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "pxd-btn pxd-later__close";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close");
  bar.append(title, close);
  const body = doc.createElement("div");
  body.className = "pxd-later__body";
  box.append(bar, body);
  let mode = null;
  const offs = [];
  const listen = (el, type, fn) => {
    el.addEventListener(type, fn);
    offs.push(() => el.removeEventListener(type, fn));
  };
  const stop = (event) => event.stopPropagation?.();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box, type, stop);
  }
  listen(close, "click", (event) => {
    stop(event);
    onClose?.();
  });

  const paint = () => {
    body.replaceChildren();
    const board = getBoard?.();
    if (!board || !mode) return;
    if (mode === "gallery") {
      const tiles = galleryGrid(galleryItems(board, resolve));
      if (!tiles.length) {
        body.textContent = "No images on this board";
        return;
      }
      for (const tile of tiles) {
        const cell = doc.createElement("figure");
        cell.className = "pxd-later__tile";
        if (tile.src) {
          const img = doc.createElement("img");
          img.alt = tile.title || "";
          img.src = tile.src;
          cell.append(img);
        }
        if (tile.title) {
          const cap = doc.createElement("figcaption");
          cap.textContent = tile.title;
          cell.append(cap);
        }
        body.append(cell);
      }
      return;
    }
    if (mode === "timeline") {
      const cards = [...board.items.values()].filter((item) => item.type === "card");
      const axis = timelineAxis(cards, { resolve });
      if (!axis.length) {
        body.textContent = "No dated cards. A card counts as dated when its title or text holds a date attribute (2026-10-03) or a daily page reference.";
        return;
      }
      for (const spot of axis) {
        const node = doc.createElement("div");
        node.className = "pxd-later__tick";
        node.style.left = `${Math.round(spot.x)}px`;
        node.textContent = spot.title || spot.uid;
        body.append(node);
      }
      return;
    }
    const graph = derivedGraph(board);
    const pos = graphLayout(graph.nodes, graph.links);
    if (!pos.size) {
      body.textContent = "No cards to graph";
      return;
    }
    const spread = Math.min(6, Math.max(1, pos.size * 0.26));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x * spread);
      minY = Math.min(minY, p.y * spread);
      maxX = Math.max(maxX, p.x * spread);
      maxY = Math.max(maxY, p.y * spread);
    }
    const at = (p) => ({ x: Math.round(110 + p.x * spread - minX), y: Math.round(40 + p.y * spread - minY) });
    const width = Math.round(maxX - minX + 220);
    const height = Math.round(maxY - minY + 80);
    body.style.minWidth = `${width}px`;
    body.style.minHeight = `${height}px`;
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pxd-later__links");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    for (const [from, to] of graph.links) {
      const a = pos.get(from);
      const b = pos.get(to);
      if (!a || !b) continue;
      const pa = at(a);
      const pb = at(b);
      const line = doc.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "pxd-later__link");
      line.setAttribute("x1", String(pa.x));
      line.setAttribute("y1", String(pa.y));
      line.setAttribute("x2", String(pb.x));
      line.setAttribute("y2", String(pb.y));
      svg.append(line);
    }
    body.append(svg);
    for (const [uid, p] of pos) {
      const node = doc.createElement("div");
      node.className = "pxd-later__node";
      const spot = at(p);
      node.style.left = `${spot.x}px`;
      node.style.top = `${spot.y}px`;
      node.style.transform = "translate(-50%, -50%)";
      node.textContent = cardLabel(board.items.get(uid), resolve) || uid;
      body.append(node);
    }
  };

  return {
    open(next) {
      if (!TITLES[next]) return false;
      mode = next;
      title.textContent = TITLES[next];
      box.hidden = false;
      paint();
      return true;
    },
    close() {
      mode = null;
      box.hidden = true;
      body.replaceChildren();
    },
    refresh() { if (mode) paint(); },
    isOpen: () => Boolean(mode),
    mode: () => mode,
    dispose() {
      mode = null;
      offs.splice(0).forEach((off) => off());
      box.remove();
    },
  };
}

export function mountPrintSheet(doc, board) {
  const sheet = doc.createElement("div");
  sheet.className = "pxd-print";
  for (const page of printPages(board)) {
    const section = doc.createElement("section");
    section.className = "pxd-print__page";
    section.dataset.uid = page.uid;
    const heading = doc.createElement("h1");
    heading.textContent = page.title;
    section.append(heading);
    sheet.append(section);
  }
  return sheet;
}
