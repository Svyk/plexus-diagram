// MEM-1 popover. Its own pxd-root on document.body. Dates are links only when the page exists.

import { placePopover } from "../relchips.js";
import { buckets, formatMade, headerText, refsLine } from "../model/halo.js";

const NS = "http://www.w3.org/2000/svg";

function darkDoc(doc) {
  return Boolean(doc.querySelector?.(".bp3-dark, .bt-theme-dark, .rm-dark-theme, body.roam-body.dark"));
}

function sparkline(doc, counts) {
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("class", "pxd-halo__spark");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const max = Math.max(1, ...counts);
  counts.forEach((count, index) => {
    const h = count === 0 ? 1 : Math.max(1, Math.round((count / max) * 20));
    const rect = doc.createElementNS(NS, "rect");
    rect.setAttribute("x", String(index * 10));
    rect.setAttribute("y", String(24 - h));
    rect.setAttribute("width", "8");
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "currentColor");
    rect.setAttribute("data-count", String(count));
    svg.append(rect);
  });
  return svg;
}

function dateNode(doc, ms, { pageExists, renderString, mounts }) {
  const label = formatMade(ms);
  const node = doc.createElement("span");
  node.className = "pxd-halo__date";
  if (!label) return node;
  const exists = typeof pageExists === "function" ? Boolean(pageExists(label)) : false;
  if (!exists || typeof renderString !== "function") {
    node.textContent = label;
    return node;
  }
  const link = doc.createElement("span");
  link.className = "pxd-halo__link";
  node.append(link);
  mounts.push(link);
  try { renderString(link, `[[${label}]]`); } catch { link.textContent = label; }
  return node;
}

export function openHaloPopover({
  doc = globalThis.document,
  anchor,
  model = {},
  pageExists,
  renderString,
  unmount,
  onPulse,
  dustAge,
} = {}) {
  const mounts = [];
  const pop = doc.createElement("div");
  pop.className = "pxd-halo pxd-root";
  if (darkDoc(doc)) pop.classList.add("pxd-root--dark");
  pop.style.position = "fixed";
  pop.style.width = "320px";

  const head = doc.createElement("div");
  head.className = "pxd-halo__head";
  head.append("Made ");
  head.append(dateNode(doc, model.created, { pageExists, renderString, mounts }));
  const where = String(model.board || "").trim() || "Untitled board";
  const section = String(model.section || "").trim();
  head.append(` on ${where}${section ? ` › ${section}` : ""}`);
  const name = String(model.userName || "").trim();
  if (name) head.append(` by ${name}`);
  pop.append(head);

  const withRow = doc.createElement("div");
  withRow.className = "pxd-halo__with";
  withRow.append("With: ");
  const company = Array.isArray(model.with) ? model.with.slice(0, 6) : [];
  if (!company.length) withRow.append("none");
  company.forEach((row, index) => {
    if (index) withRow.append(", ");
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxd-halo__company";
    button.textContent = row.label || "card";
    button.setAttribute("data-uid", row.uid || "");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (row.uid) onPulse?.(row.uid);
    });
    withRow.append(button);
  });
  pop.append(withRow);

  const refs = doc.createElement("div");
  refs.className = "pxd-halo__refs";
  const times = model.refTimes || [];
  const finite = times.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!finite.length) {
    refs.textContent = refsLine(finite, model.refTotal);
  } else {
    const shown = Number.isFinite(model.refTotal) && model.refTotal >= finite.length ? model.refTotal : finite.length;
    const noun = shown === 1 ? "time" : "times";
    refs.append(`Referenced ${shown} ${noun}, first `);
    refs.append(dateNode(doc, Math.min(...finite), { pageExists, renderString, mounts }));
    refs.append(", last ");
    refs.append(dateNode(doc, Math.max(...finite), { pageExists, renderString, mounts }));
  }
  pop.append(refs);

  const counts = buckets(finite);
  const spark = sparkline(doc, counts);
  spark.setAttribute("data-sum", String(counts.reduce((sum, n) => sum + n, 0)));
  pop.append(spark);

  const boards = doc.createElement("div");
  boards.className = "pxd-halo__boards";
  const n = Number(model.boards);
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  boards.textContent = `On ${count} ${count === 1 ? "board" : "boards"}`;
  pop.append(boards);

  const age = String(dustAge ?? "").trim();
  if (age) {
    pop.setAttribute("data-dust-age", age);
    const dust = doc.createElement("div");
    dust.className = "pxd-halo__dust";
    dust.textContent = age;
    pop.append(dust);
  }

  pop.addEventListener("pointerdown", (event) => {
    if (event.target?.closest?.("[data-link-uid], .rm-page-ref, .pxd-halo__link")) return;
    event.stopPropagation();
  });

  doc.body?.append(pop);
  const box = anchor || { left: 16, top: 16, right: 48, bottom: 40 };
  const view = doc.defaultView || globalThis;
  const placed = placePopover({
    anchor: box,
    size: { w: 320, h: 180 },
    viewport: { left: 0, top: 0, right: view.innerWidth || 800, bottom: view.innerHeight || 600 },
  });
  pop.style.left = `${placed.left}px`;
  pop.style.top = `${placed.top}px`;

  const close = () => {
    for (const el of mounts) {
      try { unmount?.(el); } catch { /* already gone */ }
    }
    mounts.length = 0;
    pop.remove();
  };
  return { el: pop, close, header: headerText(model), counts };
}
