// NAV-3. Year/day list for the Info panel. One click listener. No writes.

import { groupTimeline } from "../model/timeline.js";

const EMPTY = "No daily notes mention this board.";

export function mountTimeline(parent, { doc, rows = [], onOpenDay, onShowOnBoard } = {}) {
  const document = doc || globalThis.document;
  if (!document?.createElement) throw new Error("mountTimeline needs a document");

  const el = document.createElement("div");
  el.className = "pxd-timeline";
  let grouped = [];
  const collapsed = new Set();
  let disposed = false;

  const dayOf = (pageUid) => {
    for (const year of grouped) {
      for (const day of year.days) {
        if (day.pageUid === pageUid) return day;
      }
    }
    return null;
  };

  const onClick = (event) => {
    if (disposed) return;
    const show = event.target?.closest?.(".pxd-timeline__show");
    if (show && el.contains(show)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const day = dayOf(show.getAttribute("data-page-uid") || "");
      const ids = day ? [...day.cardUids].sort() : [];
      onShowOnBoard?.(new Set(ids));
      return;
    }
    const yearBtn = event.target?.closest?.(".pxd-timeline__year");
    if (yearBtn && el.contains(yearBtn)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const year = Number(yearBtn.getAttribute("data-year"));
      const days = yearBtn.parentElement?.querySelector?.(".pxd-timeline__days");
      const next = !collapsed.has(year);
      if (next) collapsed.add(year);
      else collapsed.delete(year);
      yearBtn.setAttribute("aria-expanded", next ? "false" : "true");
      if (days) {
        if (next) days.setAttribute("hidden", "");
        else days.removeAttribute("hidden");
      }
      return;
    }
    const dayRow = event.target?.closest?.(".pxd-timeline__day");
    if (dayRow && el.contains(dayRow)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const pageUid = dayRow.getAttribute("data-page-uid") || "";
      if (pageUid) onOpenDay?.(pageUid);
    }
  };

  const render = (nextRows) => {
    if (disposed) return;
    grouped = groupTimeline(nextRows);
    el.replaceChildren();
    if (!grouped.length) {
      const empty = document.createElement("div");
      empty.className = "pxd-timeline__empty";
      empty.textContent = EMPTY;
      el.append(empty);
      return;
    }
    for (const year of grouped) {
      const group = document.createElement("div");
      group.className = "pxd-timeline__group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pxd-timeline__year";
      button.setAttribute("data-year", String(year.year));
      const shut = collapsed.has(year.year);
      button.setAttribute("aria-expanded", shut ? "false" : "true");
      const label = document.createElement("span");
      label.className = "pxd-timeline__year-label";
      label.textContent = String(year.year);
      button.append(label);
      const days = document.createElement("div");
      days.className = "pxd-timeline__days";
      if (shut) days.setAttribute("hidden", "");
      for (const day of year.days) {
        const row = document.createElement("div");
        row.className = "pxd-timeline__day";
        row.setAttribute("data-page-uid", day.pageUid || "");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "pxd-timeline__open";
        open.textContent = day.title;
        const count = document.createElement("span");
        count.className = "pxd-timeline__count";
        count.textContent = String(day.count);
        const show = document.createElement("button");
        show.type = "button";
        show.className = "pxd-timeline__show";
        show.setAttribute("data-page-uid", day.pageUid || "");
        show.textContent = "Show on board";
        row.append(open, count, show);
        days.append(row);
      }
      group.append(button, days);
      el.append(group);
    }
  };

  el.addEventListener("click", onClick);
  render(rows);
  parent?.append?.(el);

  return {
    el,
    update(nextRows) { render(nextRows); },
    dispose() {
      if (disposed) return;
      disposed = true;
      el.removeEventListener("click", onClick);
      el.remove();
    },
  };
}
