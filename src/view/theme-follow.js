// Sample Roam's computed colours and write them on .pxd-root. Plexus mode, and a
// sample that fails contrast, clear those inline tokens. This does not toggle
// pxd-root--dark: the board view already owns that class.

import { applyThemeVars, deriveTheme, luminance, parseColor } from "../model/theme-colors.js";

function readProp(style, name) {
  if (!style || !name) return "";
  try {
    if (typeof style.getPropertyValue === "function") {
      const direct = style.getPropertyValue(name);
      if (direct) return String(direct);
      const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const camelValue = style.getPropertyValue(camel);
      if (camelValue) return String(camelValue);
    }
  } catch { /* stub */ }
  try {
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (style[camel]) return String(style[camel]);
    if (style[name]) return String(style[name]);
  } catch { /* stub */ }
  return "";
}

function computed(doc, el, name) {
  if (!el) return "";
  try {
    const view = doc?.defaultView;
    const fn = view && typeof view.getComputedStyle === "function"
      ? view.getComputedStyle.bind(view)
      : (typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle : null);
    if (!fn) return "";
    return readProp(fn(el), name);
  } catch {
    return "";
  }
}

// A transparent layer (Roam's .roam-body-main is often rgba(0,0,0,0)) is not a colour.
function opaqueColor(value) {
  const color = parseColor(value);
  if (!color || color.a < 0.5) return "";
  return String(value);
}

function classText(node) {
  if (!node) return "";
  if (typeof node.className === "string") return node.className;
  return "";
}

function hasClass(node, name) {
  if (!node || !name) return false;
  try { if (node.classList?.contains?.(name)) return true; } catch { /* stub */ }
  return new RegExp(`(?:^|\\s)${name}(?:\\s|$)`).test(classText(node));
}

export function hostDark(doc, background) {
  const root = doc?.documentElement;
  const body = doc?.body;
  if (hasClass(root, "bp3-dark") || hasClass(body, "bp3-dark")) return true;
  if (hasClass(body, "bt-theme-dark") || hasClass(root, "bt-theme-dark")) return true;
  if (hasClass(root, "rm-dark-theme") || hasClass(body, "rm-dark-theme")) return true;
  if (hasClass(body, "roam-body") && hasClass(body, "dark")) return true;
  const color = parseColor(background);
  return Boolean(color && luminance(color) < 0.4);
}

export function sampleRoam(doc) {
  const d = doc || globalThis.document;
  if (!d || typeof d.querySelector !== "function") {
    return { background: "", text: "", muted: "", border: "", link: "", dark: false };
  }
  let main = null;
  let article = null;
  let link = null;
  let block = null;
  try { main = d.querySelector(".roam-body-main") || d.body; } catch { main = d.body || null; }
  try { article = d.querySelector(".roam-article") || main; } catch { article = main; }
  // A link inside a real Roam block, outside any board: the colour an edited card row shows.
  try {
    // querySelectorAll returns document order, so try each selector in priority order.
    for (const sel of [".roam-article .rm-block__input .rm-page-ref--link", ".roam-article .rm-page-ref--link", ".rm-page-ref"]) {
      link = [...d.querySelectorAll(sel)].find((n) => !n.closest?.(".pxd-root")) || null;
      if (link) break;
    }
  } catch { link = null; }
  try { block = d.querySelector(".roam-block-container") || article; } catch { block = article; }
  const background = opaqueColor(computed(d, main, "background-color"))
    || opaqueColor(computed(d, d.body, "background-color"))
    || opaqueColor(computed(d, article, "background-color"));
  const text = opaqueColor(computed(d, article, "color")) || opaqueColor(computed(d, d.body, "color"));
  // Roam's default border-color is currentColor on a 0px border. That is the text, not a rule.
  const borderPx = Number.parseFloat(computed(d, block, "border-top-width")) || Number.parseFloat(computed(d, article, "border-top-width")) || 0;
  const border = borderPx > 0
    ? (opaqueColor(computed(d, block, "border-top-color")) || opaqueColor(computed(d, article, "border-top-color")))
    : "";
  const linkColor = link ? opaqueColor(computed(d, link, "color")) : "";
  return {
    background,
    text,
    muted: "",
    border,
    link: linkColor,
    dark: hostDark(d, background),
  };
}

export function createThemeFollow({ doc, root, getMode, timers } = {}) {
  let observer = null;
  let pending = null;
  const mode = () => {
    try {
      const value = typeof getMode === "function" ? getMode() : "follow-roam";
      return value === "plexus" ? "plexus" : "follow-roam";
    } catch {
      return "follow-roam";
    }
  };
  const paint = () => {
    const node = root;
    if (!node?.classList || !node.style) return;
    if (mode() !== "follow-roam") {
      applyThemeVars(node.style, null);
      try { node.classList.remove("pxd-theme--roam"); } catch { /* stub */ }
      return;
    }
    let derived = null;
    try { derived = deriveTheme(sampleRoam(doc)); } catch { derived = null; }
    if (!derived?.vars) {
      applyThemeVars(node.style, null);
      try { node.classList.remove("pxd-theme--roam"); } catch { /* stub */ }
      return;
    }
    applyThemeVars(node.style, derived.vars);
    try { node.classList.add("pxd-theme--roam"); } catch { /* stub */ }
  };
  const cancelPending = () => {
    if (typeof pending === "function") {
      try { pending(); } catch { /* cleared */ }
    }
    pending = null;
  };
  const schedule = () => {
    if (pending) return;
    if (typeof timers?.later === "function") {
      pending = timers.later(() => { pending = null; paint(); }, 150);
      return;
    }
    paint();
  };
  const start = () => {
    const head = doc?.head;
    const Observer = doc?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!head || typeof Observer !== "function" || observer) return;
    try {
      observer = new Observer(() => schedule());
      observer.observe(head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel", "media", "disabled"],
      });
    } catch {
      observer = null;
    }
  };
  const stop = () => {
    try { observer?.disconnect?.(); } catch { /* gone */ }
    observer = null;
    cancelPending();
  };
  return { apply: paint, paint, start, stop, sample: () => sampleRoam(doc) };
}
