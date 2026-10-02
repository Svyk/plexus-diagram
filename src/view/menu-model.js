// Pure model for the context menu (spec 1.2 C). buildMenu(kind, ctx) returns the item list the menu
// component renders; item ids are the contract with the view, which maps them onto session calls.
// No DOM here: everything is data so the ids, disabled and checked logic can be tested directly.

import { MIND_DEPTH_MAX, MIND_DEPTH_MIN, MIND_DIRECTIONS, MIND_SPACINGS, normalizeMindPreset } from "../model/mindmap.js";
import { PALETTE, FONT_SIZES } from "../model/schema.js";
import { SHAPES } from "../model/shapes.js";
import { partitionSnapshots } from "../model/snapshots.js";
import { STARTERS } from "../model/templates.js";

export const MENU_KINDS = ["canvas", "card", "section", "text", "edge", "multi", "board-menu"];

const SIZE_LABELS = { 16: "Small", 24: "Medium", 32: "Large", 48: "Extra large" };
const SHAPE_LABELS = {
  rectangle: "Rectangle", rounded: "Rounded", ellipse: "Ellipse",
  diamond: "Diamond", parallelogram: "Parallelogram", cylinder: "Cylinder",
};
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// Optional keys are only written when set, so items compare cleanly and carry no undefined noise.
const make = (id, label, extra = {}) => {
  const out = { id, label };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === false) continue;
    out[key] = value;
  }
  return out;
};

export function buildMenu(kind, ctx = {}) {
  const c = ctx || {};
  const count = Number.isFinite(c.count) ? c.count : null;
  const item = c.item || null;
  const empty = count === 0;
  let separators = 0;
  const sep = () => ({ id: `sep-${separators += 1}`, separator: true });

  const templateMenu = () => make("template", "New board from template…", {
    children: STARTERS.map((s) => make(`template:${s.id}`, s.title)),
  });

  // Leaves, not a parent of Expand: picking Expand still runs the remembered preset.
  const mindPresetMenu = () => {
    const preset = normalizeMindPreset(c.mindPreset);
    const dirs = MIND_DIRECTIONS.map((d) => make(`mind-dir:${d}`, cap(d), { checked: preset.direction === d }));
    const spaces = MIND_SPACINGS.map((s) => make(`mind-space:${s}`, cap(s), { checked: preset.spacing === s }));
    const depths = [];
    for (let d = MIND_DEPTH_MIN; d <= MIND_DEPTH_MAX; d++) depths.push(make(`mind-depth:${d}`, `Depth ${d}`, { checked: preset.depth === d }));
    return make("mind-preset", "Mind map preset…", {
      children: [
        ...dirs,
        sep(),
        ...spaces,
        sep(),
        ...depths,
        sep(),
        make("mind-refs:include", "Include block refs", { checked: preset.includeRefs }),
        make("mind-refs:skip", "Skip block refs", { checked: !preset.includeRefs }),
        sep(),
        make("mind-color:on", "Color branches", { checked: preset.colorBranches }),
        make("mind-color:off", "No branch color", { checked: !preset.colorBranches }),
      ],
    });
  };

  const snapshotMenus = () => {
    const parts = partitionSnapshots(c.snapshots);
    const items = [
      make("save-snapshot", "Save snapshot"),
      make("restore-snapshot", "Restore snapshot…", {
        disabled: parts.newest.length === 0,
        children: parts.newest.map((snap) => make(`snapshot:${snap.uid}`, snap.title)),
      }),
    ];
    if (parts.older.length) {
      items.push(make("older-snapshots", "Older snapshots", {
        children: parts.older.map((snap) => make(`older:${snap.uid}`, snap.title, {
          children: [
            make(`snapshot:${snap.uid}`, "Restore"),
            make(`delete-snapshot:${snap.uid}`, "Delete", { danger: true }),
          ],
        })),
      }));
    }
    return items;
  };

  const colorMenu = () => {
    const current = item?.color || null;
    return make("color", "Color", {
      children: [
        make("color:none", "No color", { checked: !current }),
        ...PALETTE.map((name) => make(`color:${name}`, cap(name), { checked: current === name })),
      ],
    });
  };
  const pinItem = (pinned) => (pinned ? make("unpin", "Unpin") : make("pin", "Pin"));
  const foldItem = (folded) => (folded ? make("unfold", "Unfold", { hint: "Cmd Alt Enter" }) : make("fold", "Fold", { hint: "Cmd Alt Enter" }));
  const tidyMenu = (disabled) => make("tidy", "Tidy", {
    disabled,
    children: [
      make("tidy:grid", "Grid"),
      make("tidy:row", "Row"),
      make("tidy:column", "Column"),
      make("tidy:outline", "Outline order"),
    ],
  });

  switch (kind) {
    case "canvas":
      return [
        make("new-card", "New card", { hint: "N" }),
        make("new-text", "New text", { hint: "T" }),
        make("new-sticky", "New sticky"),
        make("new-section", "New section", { hint: "G" }),
        make("new-board", "New board", { hint: "W" }),
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        sep(),
        make("paste", "Paste", { hint: "Cmd V", disabled: !c.canPaste }),
        make("paste-clone", "Paste as copies", { disabled: !c.canPaste }),
        sep(),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("select-all", "Select all", { hint: "Cmd A" }),
        make("fit-all", "Fit all", { hint: "Shift 1" }),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("background", "Background…"),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline"),
      ];

    case "card": {
      const folded = Boolean(c.collapsed);
      const out = [
        make("edit", c.isBoard ? "Rename board" : "Edit", { hint: "Enter" }),
        make("open", c.isBoard ? "Open board" : "Open"),
        ...(c.isBoard ? [make("open-own-page", "Open nested board in its own page")] : []),
        make("open-sidebar", "Open in sidebar", { hint: "Shift Click" }),
        sep(),
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        make("copy-ref", "Copy ref"),
        make("copy-link", "Copy link"),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        make("duplicate-ref", "Duplicate as ref"),
        sep(),
        colorMenu(),
        item?.look === "card" ? make("show-as-block", "Show as block") : make("show-as-card", "Show as card"),
        foldItem(folded),
        make("fit-height", "Fit height", { disabled: folded }),
        make("reset-size", "Reset size", { disabled: folded }),
        pinItem(Boolean(c.pinned)),
        make("select-same-color", "Select same color"),
        make("select-connected", "Select connected"),
      ];
      if (c.hasOutline) {
        out.push(make("mind-map", "Expand as mind map"));
        out.push(mindPresetMenu());
      }
      out.push(
        make("send-to", "Send to board…"),
        make("related", "Related…"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true }),
      );
      return out;
    }

    case "section":
      return [
        make("rename", "Rename", { hint: "Enter" }),
        make("select-contents", "Select contents", { disabled: empty }),
        make("select-all-in-section", "Select all in section", { disabled: empty }),
        make("select-same-color", "Select same color"),
        make("select-connected", "Select connected"),
        make("collapse-section", c.collapsed ? "Expand" : "Collapse"),
        make("section-note", c.hasNote ? "Remove description" : "Add description"),
        c.locked ? make("unlock-contents", "Unlock") : make("lock-contents", "Lock"),
        make("present-section", "Present this section"),
        sep(),
        make("fit-section", "Fit to contents", { disabled: empty }),
        make("toggle-fit", "Auto-fit", { checked: Boolean(c.fitOn) }),
        tidyMenu(empty),
        make("fold-all-in", "Fold all inside", { disabled: empty }),
        make("unfold-all-in", "Unfold all inside", { disabled: empty }),
        sep(),
        colorMenu(),
        pinItem(Boolean(c.pinned)),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        make("copy-ref", "Copy ref"),
        make("copy-png", "Copy selection as PNG"),
        sep(),
        make("delete-frame", "Delete frame", { hint: "Del", danger: true }),
        make("delete-contents", "Delete frame and contents", { hint: "Shift Del", danger: true, disabled: empty }),
      ];

    case "text":
      return [
        make("edit", "Edit", { hint: "Enter" }),
        colorMenu(),
        make("size", "Size", {
          children: FONT_SIZES.map((px) => make(`size:${px}`, `${SIZE_LABELS[px] || px} (${px}px)`, { checked: item?.fontSize === px })),
        }),
        make("shape", "Shape", {
          children: SHAPES.map((name) => make(`shape:${name}`, SHAPE_LABELS[name] || name, { checked: item?.shape === name })),
        }),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        pinItem(Boolean(c.pinned)),
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true }),
      ];

    case "edge":
      return [
        make("dir", "Direction", {
          children: [
            make("dir:one", "One way", { checked: c.dir === "one" }),
            make("dir:two", "Two way", { checked: c.dir === "two" }),
            make("dir:none", "No arrow", { checked: c.dir === "none" }),
          ],
        }),
        make("flip", "Flip direction"),
        make("route", "Route", {
          children: [
            make("route:curve", "Curve", { checked: c.route === "curve" }),
            make("route:straight", "Straight", { checked: c.route === "straight" }),
            make("route:elbow", "Elbow", { checked: c.route === "elbow" }),
          ],
        }),
        make("dash", "Line", {
          children: [
            make("dash:solid", "Solid", { checked: c.dash === "solid" }),
            make("dash:dashed", "Dashed", { checked: c.dash === "dashed" }),
          ],
        }),
        colorMenu(),
        sep(),
        make("label", "Label"),
        make("notes", "Notes"),
        make("write-to-graph", "Write to graph"),
        sep(),
        make("copy-png", "Copy selection as PNG"),
        make("delete", "Delete", { hint: "Del", danger: true }),
      ];

    case "multi": {
      const few = count !== null && count < 2;
      return [
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        colorMenu(),
        sep(),
        make("align", "Align", {
          disabled: few,
          children: ["left", "center", "right", "top", "middle", "bottom"].map((side) => make(`align:${side}`, cap(side))),
        }),
        make("distribute", "Distribute", {
          disabled: count !== null && count < 3,
          children: [make("distribute:h", "Horizontally"), make("distribute:v", "Vertically")],
        }),
        tidyMenu(false),
        make("same-size", "Same size", {
          disabled: few,
          children: [make("same-size:width", "Width"), make("same-size:height", "Height"), make("same-size:both", "Width and height")],
        }),
        foldItem(Boolean(c.anyCollapsed)),
        pinItem(Boolean(c.allPinned)),
        sep(),
        make("wrap-section", "Wrap in section", { hint: "Cmd G" }),
        make("wrap-board", "Move into new board"),
        make("send-to", "Send to board…"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true }),
      ];
    }

    case "board-menu":
      return [
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        sep(),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline"),
        make("open-outline", "Open outline in sidebar"),
        sep(),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("background", "Background…"),
        make("tidy:grid", "Tidy into a grid"),
      ];

    default:
      return [];
  }
}

// Depth-first list of every non-separator item, parents included. Handy for the view's id lookup and tests.
export function flattenMenu(items) {
  const out = [];
  const walk = (list) => {
    for (const entry of list || []) {
      if (entry.separator) continue;
      out.push(entry);
      if (entry.children) walk(entry.children);
    }
  };
  walk(items);
  return out;
}
