// PL-3: one shared hover tooltip per board. A single element under .pxd-root (screen space, so zoom never scales it),
// one pair of delegated pointer listeners and one pair of focus listeners on the root, nothing per button.
// The dismiss listeners (pointerdown, wheel, Escape) exist only while a tooltip is showing.

import { tipEntry } from "./tooltip-text.js";

const GAP = 8;
const MARGIN = 4;
const DELAYS = { instant: 0, "350 ms": 350, "800 ms": 800 };
const ID = "pxd-tooltip";

export function tooltipDelay(value) {
  return Object.hasOwn(DELAYS, value) ? DELAYS[value] : DELAYS["350 ms"];
}

// Where the tooltip prefers to sit: below the board bar, above the dock, left of the rail.
export function preferredSide(target, root) {
  if (target.closest?.(".pxd-toolbar")) return "below";
  if (target.closest?.(".pxd-rail")) return "left";
  if (target.closest?.(".pxd-palette, .pxd-dock")) {
    if (root.classList?.contains("pxd-root--dock-left")) return "right";
    return root.classList?.contains("pxd-root--dock-top") ? "below" : "above";
  }
  if (target.closest?.(".pxd-minimap")) return "left";
  return "above";
}

const OPPOSITE = { above: "below", below: "above", left: "right", right: "left" };

// Pure placement: rects are { left, top, width, height } in the same space; returns { left, top, side } for the tip.
export function placeTip({ target, tip, bounds, side }) {
  const at = (s) => {
    if (s === "below") return { left: target.left + target.width / 2 - tip.width / 2, top: target.top + target.height + GAP };
    if (s === "above") return { left: target.left + target.width / 2 - tip.width / 2, top: target.top - tip.height - GAP };
    if (s === "left") return { left: target.left - tip.width - GAP, top: target.top + target.height / 2 - tip.height / 2 };
    return { left: target.left + target.width + GAP, top: target.top + target.height / 2 - tip.height / 2 };
  };
  let use = side;
  let p = at(use);
  const vertical = side === "above" || side === "below";
  const axisFits = (pt) => (vertical
    ? pt.top >= bounds.top + MARGIN && pt.top + tip.height <= bounds.top + bounds.height - MARGIN
    : pt.left >= bounds.left + MARGIN && pt.left + tip.width <= bounds.left + bounds.width - MARGIN);
  if (bounds.width && bounds.height && !axisFits(p) && axisFits(at(OPPOSITE[side]))) { use = OPPOSITE[side]; p = at(use); }
  if (bounds.width && bounds.height) {
    const maxLeft = bounds.left + bounds.width - tip.width - MARGIN;
    const maxTop = bounds.top + bounds.height - tip.height - MARGIN;
    p = {
      left: Math.max(bounds.left + MARGIN, Math.min(p.left, maxLeft)),
      top: Math.max(bounds.top + MARGIN, Math.min(p.top, maxTop)),
    };
  }
  return { left: Math.round(p.left), top: Math.round(p.top), side: use };
}

export function createTooltip({ doc = globalThis.document, root, timers, setting } = {}) {
  const read = (k) => (typeof setting === "function" ? setting(k) : undefined);
  const tip = doc.createElement("div");
  tip.className = "pxd-tooltip pxd-chrome";
  tip.id = ID;
  tip.setAttribute("role", "tooltip");
  tip.style.display = "none";
  root.append(tip);

  const offs = [];
  const on = (node, type, fn, opts) => {
    node.addEventListener(type, fn, opts);
    offs.push(() => node.removeEventListener(type, fn, opts));
  };
  let current = null; // the control the visible tooltip describes
  let pending = null; // { target, cancel }
  let dismiss = [];

  const enabled = () => read("tooltips") !== false;
  const delay = () => tooltipDelay(read("tooltip-delay"));
  const closest = (node) => {
    const hit = node?.closest?.("[data-tip]");
    return hit && root.contains(hit) ? hit : null;
  };
  const sync = (target) => {
    const entry = tipEntry(target.getAttribute("data-tip"), target.getAttribute("data-tip-state"));
    if (!entry) return null;
    return {
      name: entry.name || target.getAttribute("aria-label") || target.getAttribute("data-tip-name") || "",
      desc: entry.desc,
      key: entry.key,
      hint: entry.hint,
      extra: target.getAttribute("data-tip-extra") || "",
    };
  };
  const fill = (info) => {
    tip.replaceChildren();
    const head = doc.createElement("div");
    head.className = "pxd-tooltip__head";
    const name = doc.createElement("strong");
    name.className = "pxd-tooltip__name";
    name.textContent = info.name;
    head.append(name);
    for (const k of [].concat(info.key || [])) {
      const kbd = doc.createElement("kbd");
      kbd.className = "pxd-tooltip__key";
      kbd.textContent = k;
      head.append(kbd);
    }
    tip.append(head);
    const add = (cls, text) => {
      if (!text) return;
      const line = doc.createElement("div");
      line.className = `pxd-tooltip__${cls}`;
      line.textContent = text;
      tip.append(line);
    };
    add("desc", info.desc);
    add("extra", info.extra);
    add("hint", info.hint);
  };
  const place = (target) => {
    const rr = root.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const r = { left: tr.left - rr.left, top: tr.top - rr.top, width: tr.width, height: tr.height };
    const size = { width: tip.offsetWidth || 0, height: tip.offsetHeight || 0 };
    const bounds = { left: 0, top: 0, width: rr.width, height: rr.height };
    const at = placeTip({ target: r, tip: size, bounds, side: preferredSide(target, root) });
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    tip.setAttribute("data-side", at.side);
  };

  const hide = () => {
    pending?.cancel?.();
    pending = null;
    for (const off of dismiss.splice(0)) off();
    if (current) {
      if (current.getAttribute("aria-describedby") === ID) current.removeAttribute("aria-describedby");
      current = null;
    }
    tip.style.display = "none";
  };
  const show = (target) => {
    if (!target || target.isConnected === false) return;
    const info = sync(target);
    if (!info) return;
    if (current && current !== target && current.getAttribute("aria-describedby") === ID) current.removeAttribute("aria-describedby");
    pending = null;
    fill(info);
    tip.style.display = "";
    current = target;
    target.setAttribute("aria-describedby", ID);
    place(target);
    if (!dismiss.length) {
      const off = (node, type, fn, opts) => {
        node.addEventListener(type, fn, opts);
        dismiss.push(() => node.removeEventListener(type, fn, opts));
      };
      off(root, "pointerdown", hide, true);
      off(root, "wheel", hide, { capture: true, passive: true });
      off(root, "scroll", hide, true);
      off(doc, "keydown", (event) => { if (event.key === "Escape") hide(); }, true);
    }
  };
  const schedule = (target) => {
    if (current === target || pending?.target === target) return;
    pending?.cancel?.();
    pending = null;
    if (!tipEntry(target.getAttribute("data-tip"), target.getAttribute("data-tip-state"))) return;
    if (!enabled()) {
      // Off: hand the text back to the browser's native tooltip, written just before it would show.
      const info = sync(target);
      if (info) target.title = info.key ? `${info.name} (${[].concat(info.key).join(" ")}). ${info.desc}` : `${info.name}. ${info.desc}`;
      return;
    }
    const wait = current ? 0 : delay();
    if (wait <= 0) { show(target); return; }
    const cancel = timers?.later ? timers.later(() => show(target), wait) : (() => { const t = setTimeout(() => show(target), wait); return () => clearTimeout(t); })();
    pending = { target, cancel };
  };

  on(root, "pointerover", (event) => {
    if (event.buttons) return;
    const target = closest(event.target);
    if (!target) return;
    schedule(target);
  });
  on(root, "pointerout", (event) => {
    const from = closest(event.target);
    if (!from) return;
    const to = event.relatedTarget;
    if (to && from.contains?.(to)) return;
    if (pending?.target === from) { pending.cancel?.(); pending = null; }
    if (current === from) hide();
  });
  on(root, "focusin", (event) => {
    const target = closest(event.target);
    if (!target || !enabled()) return;
    try {
      if (typeof target.matches === "function" && target.matches(":focus-visible") === false) return;
    } catch { /* an older engine: show */ }
    pending?.cancel?.();
    pending = null;
    show(target);
  });
  on(root, "focusout", (event) => {
    const from = closest(event.target);
    if (!from) return;
    if (pending?.target === from) { pending.cancel?.(); pending = null; }
    if (current === from) hide();
  });

  return {
    el: tip,
    show,
    hide,
    isVisible: () => tip.style.display !== "none",
    target: () => current,
    dispose() {
      hide();
      for (const off of offs.splice(0)) off();
      tip.remove();
    },
  };
}
