// Pure model for the context menu (spec 1.2 C). buildMenu(kind, ctx) returns the item list the menu
// component renders; item ids are the contract with the view, which maps them onto session calls.
// No DOM here: everything is data so the ids, disabled and checked logic can be tested directly.

import { MIND_DEPTH_MAX, MIND_DEPTH_MIN, MIND_DIRECTIONS, MIND_SPACINGS, normalizeMindPreset } from "../model/mindmap.js";
import { PALETTE, FONT_SIZES, DOCK_POSITIONS } from "../model/schema.js";
import { SHAPES } from "../model/shapes.js";
import { partitionSnapshots } from "../model/snapshots.js";
import { regionMenu } from "../model/region-menu.js";
import { STARTERS } from "../model/templates.js";

export const MENU_KINDS = ["canvas", "card", "section", "text", "edge", "multi", "board-menu"];
export const STATUS_WRITE_CAP = 45;

const SIZE_LABELS = { 16: "Small", 24: "Medium", 32: "Large", 48: "Extra large" };
const SHAPE_LABELS = {
  rectangle: "Rectangle", rounded: "Rounded", ellipse: "Ellipse",
  diamond: "Diamond", parallelogram: "Parallelogram", cylinder: "Cylinder",
};
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function statusRows(source) {
  const value = typeof source === "function" ? source() : source;
  if (!value) return [];
  if (typeof value.values === "function" && !Array.isArray(value)) return [...value.values()];
  return [...value];
}

// Shown only when the caller says the Task Status Tags API is there. The view maps status:<name> and status:remove.
function statusSubmenu(c) {
  const api = c.statusTags;
  if (typeof api?.available !== "function" || api.available() !== true) return null;
  const current = String(c.status ?? "").trim().toLowerCase();
  const children = [];
  for (const row of statusRows(api.palette)) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    children.push(make(`status:${name}`, name, {
      checked: name.toLowerCase() === current,
      glyph: row.glyph,
    }));
  }
  children.push(make("status:remove", "Remove status"));
  return make("status", "Status ▸", { children });
}

function trailChildren(c, prefix) {
  const trails = Array.isArray(c.trails) ? c.trails : [];
  const children = [];
  for (const trail of trails) {
    if (!trail?.uid) continue;
    children.push(make(`${prefix}:${trail.uid}`, trail.name || "Trail"));
  }
  children.push(make(`${prefix}:new`, "New trail…"));
  return children;
}

function trailItem(c) {
  return make("trail", "Add to trail ▸", { children: trailChildren(c, "trail-add") });
}

function selectionTrailItem(c) {
  return make("trail-sel", "Add selection to trail ▸", { children: trailChildren(c, "trail-sel") });
}

function landmarkItem(c) {
  const on = c.landmark === true;
  if (!on) return make("landmark-toggle", "Make landmark");
  const size = c.landmarkSize === "S" || c.landmarkSize === "L" ? c.landmarkSize : "M";
  return make("landmark", "Landmark", {
    children: [
      make("landmark-toggle", "Remove landmark", { checked: true }),
      make("landmark-glyph", "Glyph…"),
      make("landmark-size:S", "Small", { checked: size === "S" }),
      make("landmark-size:M", "Medium", { checked: size === "M" }),
      make("landmark-size:L", "Large", { checked: size === "L" }),
    ],
  });
}

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
    children: STARTERS.map((s) => make(`template:${s.id}`, s.id === "timeline" ? "Timeline template" : s.title)),
  });

  // The Timeline view and the Timeline template used to share one label.
  const viewsMenu = () => make("views", "Views", {
    children: [
      make("gallery", "Gallery"),
      make("timeline", "Timeline"),
      make("graph", "Graph"),
    ],
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
        ...(c.taskTool === false ? [] : [make("new-task", "New task", { hint: "K" })]),
        make("new-text", "New text", { hint: "T" }),
        make("new-sticky", "New sticky"),
        make("new-section", "New section", { hint: "G" }),
        make("new-lane-h", "Horizontal lane"),
        make("new-lane-v", "Vertical lane"),
        make("new-board", "New board", { hint: "W" }),
        make("new-drawing", "New drawing here"),
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        sep(),
        make("paste", "Paste", { hint: "Cmd V", disabled: !c.canPaste }),
        make("paste-clone", "Paste as copies", { disabled: !c.canPaste }),
        sep(),
        make("add-page", "Add page…"),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("select-all", "Select all", { hint: "Cmd A" }),
        make("fit-all", "Fit all", { hint: "Shift 1" }),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("background", "Background…"),
        make("bg-image", "Lock copied image as background"),
        viewsMenu(),
        make("print", "Print…"),
        make("highlights", "Highlight marks"),
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
        ...(c.compass && c.interop !== false ? [make("open-compass", "Open in Compass")] : []),
        ...(c.isPdf ? [make("read-inline", c.inlineReader ? "Show the cover" : "Read inside the card")] : []),
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
        ...(c.canMakeTask ? [make("make-task", "Make task")] : []),
        make("apply-template", "Add attribute template"),
        make("version-peek", "Version history"),
        foldItem(folded),
        make("fit-height", "Fit height", { disabled: folded }),
        make("reset-size", "Reset size", { disabled: folded }),
        pinItem(Boolean(c.pinned)),
        make("select-same-color", "Select same color"),
        make("select-connected", "Select connected"),
      ];
      const regionsItem = regionMenu(c.regions);
      if (regionsItem) {
        const at = out.findIndex((row) => row.id === "color");
        out.splice(at < 0 ? out.length : at, 0, regionsItem);
      }
      const statusItem = statusSubmenu(c);
      if (statusItem) {
        const at = out.findIndex((row) => row.id === "color");
        out.splice(at < 0 ? out.length : at + 1, 0, statusItem);
      }
      if (c.hasOutline) {
        out.push(make("mind-map", "Expand as mind map"));
        out.push(mindPresetMenu());
      }
      if (c.canSpread) out.push(make("spread-children", "Spread children as cards"));
      if (c.isQuery) out.push(make("query-results", "Add results as cards"));
      if (c.canExpand) {
        out.push(make("neighbors:out", "Add pages it links to"));
        out.push(make("neighbors:in", "Add pages that link here"));
        out.push(make("neighbors:attr", "Add attribute values"));
      }
      if (c.canAnnotate) out.push(make("annotate-drawing", "Annotate as drawing"));
      out.push(
        make("send-to", "Send to board…"),
        make("related", "Related…"),
        make("context", "Context"),
        trailItem(c),
        landmarkItem(c),
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
        make("layout-dates", "Lay out by date"),
        make("date-source", "Date source", {
          children: [
            make("date-source:attribute", "Attribute", { checked: !c.dateSource || c.dateSource === "attribute" }),
            make("date-source:first", "First mention", { checked: c.dateSource === "first" }),
            make("date-source:last", "Last mention", { checked: c.dateSource === "last" }),
          ],
        }),
        make("focus-timer", "Focus timer"),
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
        trailItem(c),
        landmarkItem(c),
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
        trailItem(c),
        landmarkItem(c),
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
        ...(c.blockEnd ? [make("unblock", "Connect to the page instead")] : []),
        make("route", "Route", {
          children: [
            make("route:curve", "Curve", { checked: c.route === "curve" }),
            make("route:straight", "Straight", { checked: c.route === "straight" }),
            make("route:elbow", "Elbow", { checked: c.route === "elbow" }),
            make("route:around", "Around cards", { checked: c.route === "around" }),
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
        make("add-bend", "Add bend"),
        make("clear-bends", "Clear bends"),
        make("label", "Label"),
        make("edit-why", "Edit why"),
        make("notes", "Notes"),
        make("write-to-graph", "Write to graph"),
        sep(),
        make("copy-png", "Copy selection as PNG"),
        make("context", "Context"),
        make("delete", "Delete", { hint: "Del", danger: true }),
      ];

    case "multi": {
      const few = count !== null && count < 2;
      const statusItem = statusSubmenu(c);
      return [
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        colorMenu(),
        ...(statusItem ? [statusItem] : []),
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
        ...(c.sectionPair ? [make("group-connect", "Connect sections")] : []),
        make("wrap-section", "Wrap in section", { hint: "Cmd G" }),
        make("wrap-board", "Move into new board"),
        make("save-view-selection", "Save view of selection"),
        make("send-to", "Send to board…"),
        selectionTrailItem(c),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true }),
      ];
    }

    case "board-menu":
      return [
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        make("save-view", "Save view…"),
        make("memory-lane", "Memory lane", { hint: "Shift T" }),
        ...(c.lens ? [
          make("lens-strength", "Strength", { checked: c.strength === true }),
          make("lens-dust", "Dust", {
            children: [
              make("lens-dust:off", "Off", { checked: !c.dust || c.dust === "off" }),
              make("lens-dust:6 months", "6 months", { checked: c.dust === "6 months" }),
              make("lens-dust:1 year", "1 year", { checked: c.dust === "1 year" }),
              make("lens-dust:2 years", "2 years", { checked: c.dust === "2 years" }),
            ],
          }),
        ] : []),
        ...(c.walk ? [make("walk", "Walk", {
          children: [
            make("walk:reading", "Reading order"),
            make("walk:nearest", "Nearest next"),
            make("walk:trail", "Along the trail", { disabled: !c.hasTrail }),
          ],
        })] : []),
        sep(),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline"),
        make("sort-outline", "Sort outline by position"),
        make("open-outline", "Open outline in sidebar"),
        sep(),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("add-page", "Add page…"),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("background", "Background…"),
        viewsMenu(),
        make("dock", "Dock position for this board", {
          children: [
            ...DOCK_POSITIONS.map((d) => make(`dock:${d}`, cap(d), { checked: c.dock === d })),
            sep(),
            make("dock:default", "Use setting", { checked: !DOCK_POSITIONS.includes(c.dock) }),
          ],
        }),
        make("tidy:grid", "Tidy into a grid"),
      ];

    default:
      return [];
  }
}

// One setStatus per card, in order, and never more than 45 (one Roam undo budget). A rejection does not stop the rest.
export async function applyStatusPicks(uids, name, setStatus, onProgress, toast) {
  const list = [...(uids || [])].filter((uid) => uid).slice(0, STATUS_WRITE_CAP);
  const total = list.length;
  const rejected = [];
  for (let i = 0; i < list.length; i += 1) {
    const uid = list[i];
    let res;
    try {
      res = await setStatus(uid, name);
    } catch (error) {
      res = { status: "rejected", reason: error?.message || "Could not set that status" };
    }
    if (!res || res.status === "rejected" || res.status === "unknown" || res.status === "conflict" || res.status === "not-updated") {
      rejected.push({ uid, reason: res?.reason || "" });
      if (typeof toast === "function") toast({ message: res?.reason || "Could not set that status" });
    }
    if (typeof onProgress === "function") onProgress({ done: i + 1, total, uid, name });
  }
  return { applied: total, rejected };
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
