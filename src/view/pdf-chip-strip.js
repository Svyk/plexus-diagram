// PDF-7 page chips. A click pulses card uids after 280 ms. A double-click cancels that and opens the page.

export function paintPdfChipStrip(doc, parent, chips, handlers) {
  const strip = doc.createElement("div");
  strip.className = "pxd-pdf-chips pxd-chrome";
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "PDF pages");
  const stop = (event) => event.stopPropagation?.();
  for (const type of ["pointerdown", "mousedown", "dblclick"]) strip.addEventListener(type, stop);
  strip.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = event.target?.closest?.(".pxd-pdf-chip");
    if (!button || !strip.contains(button)) return;
    event.preventDefault();
    stop(event);
    handlers?.onOpen?.(button._pxdPage);
  });
  for (const chip of chips || []) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("type", "button");
    button.className = "pxd-pdf-chip pxd-chrome";
    button._pxdPage = chip.page;
    button.setAttribute("data-page", String(chip.page));
    button.setAttribute("aria-label", `Page ${chip.page}, ${chip.count}`);
    button.append(doc.createTextNode(String(chip.page)));
    const badge = doc.createElement("span");
    badge.className = "pxd-pdf-chip__n";
    badge.textContent = String(chip.count);
    button.append(badge);
    let armed = false;
    button.addEventListener("pointerdown", stop);
    button.addEventListener("mousedown", stop);
    button.addEventListener("click", () => {
      armed = true;
      handlers.later(() => {
        if (!armed) return;
        armed = false;
        handlers.onPulse(chip.uids);
      }, 280);
    });
    button.addEventListener("dblclick", (event) => {
      armed = false;
      stop(event);
      handlers.onOpen(chip.page);
    });
    strip.append(button);
  }
  parent.append(strip);
  return strip;
}
