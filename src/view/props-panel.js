// Collapsible Properties panel. Selection styles, section defaults, and the diagram
// background. Collapsed state is per device (localStorage), not a Roam prop.

import { ALIGNS, BOARD_PATTERNS, CARD_FONT_DEFAULT, CARD_FONT_MAX, CARD_FONT_MIN, DIRS, ROUTES, SECTION_TITLE_DEFAULT, SECTION_TITLE_MAX, SECTION_TITLE_MIN, cssColor } from "../model/schema.js";
import { buildColorPicker } from "./color-picker.js";

const STORAGE_KEY = "pxd-props-collapsed";
const PATTERN_LABELS = { dots: "Dots", lines: "Lines", cross: "Cross", grid: "Grid", plain: "Plain" };
const DIR_LABELS = [["one", "Directed"], ["none", "Undirected"], ["two", "Bidirected"]];
const DASH_LABELS = [["solid", "Solid"], ["dashed", "Dashed"], ["animated", "Animated"]];
const ROUTE_LABELS = [["straight", "Straight"], ["elbow", "Smooth step"], ["curve", "Curve"]];

export function createPropsPanel({ doc = globalThis.document, root, storage, on = {} } = {}) {
  const listeners = [];
  const listen = (el, type, fn) => {
    el.addEventListener(type, fn);
    listeners.push(() => el.removeEventListener(type, fn));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  // tipId: the hover text comes from tooltip-text.js, so no native title (PL-3).
  const button = (parent, cls, label, title, fn, tipId) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (tipId) b.setAttribute("data-tip", tipId);
    else if (title) b.title = title;
    const name = String(label || "").trim() || title || "";
    if (name) b.setAttribute("aria-label", name);
    listen(b, "click", (event) => { event.preventDefault(); event.stopPropagation(); fn?.(event); });
    return b;
  };

  let collapsed = storage?.getItem?.(STORAGE_KEY) === "1";
  const panel = el("div", "pxd-props pxd-chrome", root);
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Properties");
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(panel, type, (event) => event.stopPropagation());
  }
  listen(panel, "keydown", (event) => event.stopPropagation());

  const head = button(panel, "pxd-props__toggle", "Properties", "Properties", () => {
    collapsed = !collapsed;
    storage?.setItem?.(STORAGE_KEY, collapsed ? "1" : "0");
    paintCollapsed();
    place();
  }, "props.toggle");
  head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const body = el("div", "pxd-props__body", panel);

  const paintCollapsed = () => {
    panel.classList.toggle("pxd-props--collapsed", collapsed);
    body.style.display = collapsed ? "none" : "";
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };

  const place = () => {
    const tb = root.querySelector?.(".pxd-toolbar");
    const h = tb?.offsetHeight || 0;
    panel.style.top = `${8 + (h ? h + 6 : 44)}px`;
  };

  const choice = (parent, options, current, fn, tip) => {
    const wrap = el("div", "pxd-seg pxd-props__choices", parent);
    for (const [value, label] of options) {
      const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}`, label, label, () => fn(value), `props.choice.${tip}`);
      b.setAttribute("data-value", value);
    }
    return wrap;
  };

  const stepper = (parent, { value, fallback, min, max, aria, onCommit }) => {
    const shown = Number.isInteger(value) ? value : fallback;
    const row = el("div", "pxd-props__step", parent);
    const input = el("input", "pxd-input pxd-props__num", row);
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(shown);
    input.setAttribute("aria-label", aria);
    input.setAttribute("data-tip", "props.step.input");
    const commit = (n) => {
      const v = Number(n);
      if (!Number.isInteger(v) || v < min || v > max) { input.value = String(shown); return; }
      onCommit(v);
    };
    const dec = button(row, "pxd-props__dec", "−", "Smaller", () => commit(shown - 1), "props.step.dec");
    row.insertBefore(dec, input);
    button(row, "pxd-props__inc", "+", "Larger", () => commit(shown + 1), "props.step.inc");
    listen(input, "change", () => commit(input.value));
    listen(input, "keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); commit(input.value); }
    });
  };

  const colorField = (parent, label, value, fn) => {
    const row = el("div", "pxd-props__field", parent);
    el("span", "pxd-props__label", row, label);
    const chip = button(row, "pxd-props__chip", "", label, () => {
      const open = row.querySelector(".pxd-picker");
      if (open) { open.remove(); return; }
      const picker = buildColorPicker(doc, (c) => fn(c), listen);
      row.append(picker);
    }, "props.chip");
    chip.setAttribute("aria-label", label);
    const sw = el("span", "pxd-props__chip-swatch", chip);
    const painted = value === "paper" ? "#eeeded" : (cssColor(value, "fill") || "");
    if (painted) sw.style.background = painted;
    else sw.classList.add("pxd-props__chip-swatch--empty");
  };

  const group = (title, key) => {
    const g = el("section", "pxd-props__group", body);
    g.setAttribute("data-group", key);
    const h = el("h3", "pxd-props__heading", g, title);
    h.setAttribute("data-tip", `props.group.${key}`);
    return g;
  };

  const blocks = (items) => {
    const g = group("Blocks", "blocks");
    const cards = items.filter((it) => it.type !== "text");
    const text = items.filter((it) => it.type === "text");
    const sample = cards[0] || text[0];
    const fallback = sample?.type === "text" ? 24 : CARD_FONT_DEFAULT;
    const same = items.every((it) => (it.fontSize ?? fallback) === (sample.fontSize ?? fallback));
    el("span", "pxd-props__label", g, "Text size");
    stepper(g, {
      value: same ? sample.fontSize : undefined,
      fallback,
      min: CARD_FONT_MIN,
      max: CARD_FONT_MAX,
      aria: "Text size",
      onCommit: (v) => on.setItemStyle?.({ fontSize: v }),
    });
    colorField(g, "Text color", same ? sample.textColor : undefined, (c) => on.setItemStyle?.({ textColor: c }));
    el("span", "pxd-props__label", g, "Align");
    const align = same ? (sample.align || "") : "";
    choice(g, [["", "Default"], ...ALIGNS.map((a) => [a, a[0].toUpperCase() + a.slice(1)])], align, (v) => on.setItemStyle?.({ align: v || null }), "align");
    colorField(g, "Fill", same ? sample.fill : undefined, (c) => on.setItemStyle?.({ fill: c }));
    colorField(g, "Border", same ? sample.border : undefined, (c) => on.setItemStyle?.({ border: c }));
    button(g, "pxd-props__reset", "Reset selected", "Remove text size, color, align, fill, and border", () => on.resetItems?.(), "props.reset");
  };

  const edgeGroup = (edge) => {
    const g = group("Connection", "edge");
    el("span", "pxd-props__label", g, "Direction");
    choice(g, DIR_LABELS, DIRS.includes(edge.dir) ? edge.dir : "one", (v) => on.setEdge?.({ dir: v }), "dir");
    el("span", "pxd-props__label", g, "Decoration");
    choice(g, DASH_LABELS, edge.dash || "solid", (v) => on.setEdge?.({ dash: v }), "dash");
    el("span", "pxd-props__label", g, "Type");
    choice(g, ROUTE_LABELS, ROUTES.includes(edge.route) ? edge.route : "curve", (v) => on.setEdge?.({ route: v }), "route");
    el("span", "pxd-props__label", g, "Weight");
    choice(g, [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], [1, 2, 3, 4].includes(edge.weight) ? edge.weight : 1, (v) => on.setEdge?.({ weight: v }), "weight");
    colorField(g, "Color", edge.color, (c) => on.setEdge?.({ color: c }));
    button(g, "pxd-props__reset", "Reset", "Remove direction, decoration, type, weight, and color", () => on.resetEdge?.(), "props.reset");
  };

  const sectionGroup = (items, title, key, write, resetLabel, reset) => {
    const g = group(title, key);
    const sample = items[0];
    const defs = key === "group" ? (sample.sectionDefaults || {}) : {};
    const pick = (field, fallback) => {
      const values = items.map((it) => (it[field] ?? defs[field] ?? fallback));
      return values.every((v) => v === values[0]) ? values[0] : undefined;
    };
    el("span", "pxd-props__label", g, "Title size");
    stepper(g, {
      value: sample.titleSize ?? defs.titleSize,
      fallback: SECTION_TITLE_DEFAULT,
      min: SECTION_TITLE_MIN,
      max: SECTION_TITLE_MAX,
      aria: "Title size",
      onCommit: (v) => write({ titleSize: v }),
    });
    colorField(g, "Title color", pick("titleColor"), (c) => write({ titleColor: c }));
    colorField(g, "Title fill", pick("titleFill"), (c) => write({ titleFill: c }));
    colorField(g, "Area fill", pick("areaFill"), (c) => write({ areaFill: c }));
    colorField(g, "Border", pick("border"), (c) => write({ border: c }));
    button(g, "pxd-props__reset", resetLabel, resetLabel, reset, "props.reset");
  };

  const defaultsGroup = (board) => {
    const stored = board?.defaults?.section || {};
    sectionGroup(
      [{ ...stored, sectionDefaults: {} }],
      "Default groups",
      "defaults",
      (patch) => on.setDefaults?.(patch),
      "Reset default",
      () => on.resetDefaults?.(),
    );
  };

  const diagram = (board) => {
    const g = group("Diagram", "diagram");
    const bg = board?.plexus || {};
    colorField(g, "Background", bg.bgColor, (c) => on.setBackground?.({ bgColor: c }));
    el("span", "pxd-props__label", g, "Texture");
    const pattern = BOARD_PATTERNS.includes(bg.bg) ? bg.bg : "";
    choice(g, [["", "Default"], ...BOARD_PATTERNS.map((p) => [p, PATTERN_LABELS[p] || p])], pattern, (v) => on.setBackground?.({ bg: v || null }), "texture");
    button(g, "pxd-props__reset", "Reset default", "Clear this board's background", () => on.setBackground?.({ bg: null, bgColor: null }), "props.reset");
  };

  let last = null;
  const refresh = (state) => {
    last = state || last;
    const active = doc.activeElement;
    if (active && panel.contains(active) && String(active.tagName).toLowerCase() === "input") return;
    body.replaceChildren();
    const items = (last?.items || []).filter(Boolean);
    const edge = last?.edge || null;
    const board = last?.board;
    if (edge) edgeGroup(edge);
    else {
      const blocksItems = items.filter((it) => it.type === "card" || it.type === "text");
      const sections = items.filter((it) => it.type === "section");
      if (blocksItems.length) blocks(blocksItems);
      if (sections.length) {
        sectionGroup(sections, "Group", "group", (patch) => on.setSectionStyle?.(patch), "Reset", () => on.resetSections?.());
      }
      if (!blocksItems.length && !sections.length) defaultsGroup(board);
    }
    diagram(board);
    place();
  };

  paintCollapsed();
  place();

  return {
    el: panel,
    refresh,
    place,
    isCollapsed: () => collapsed,
    dispose() {
      listeners.splice(0).forEach((off) => off());
      panel.remove();
    },
  };
}
