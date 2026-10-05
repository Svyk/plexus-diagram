// PDF-7 page chips. A click pulses card uids after 280 ms. A double-click cancels that and opens the page.

export function paintPdfChipStrip(doc, parent, chips, handlers) {
  const strip = doc.createElement("div");
  strip.className = "pxd-pdf-chips pxd-chrome";
  const stop = (event) => event.stopPropagation?.();
  for (const type of ["pointerdown", "mousedown", "dblclick"]) strip.addEventListener(type, stop);
  for (const chip of chips || []) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("type", "button");
    button.className = "pxd-pdf-chip pxd-chrome";
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
