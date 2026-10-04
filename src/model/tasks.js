// Task cards read Better Tasks attribute children (BT_attrDue:: and friends) off a card's children. Plexus never
// writes them: every change goes through the Better Tasks tools (src/host/bt.js).
import { attrNameOf } from "./schema.js";

const ACTIVITY_LOG = "**Activity log**";
const lower = (s) => String(s ?? "").trim().toLowerCase();

// Default labels by Better Tasks attribute id. Names can be renamed in Better Tasks: setTaskAttrNames() holds the
// live labels from bt_get_attributes, and /^BT_attr/ covers the rest until they arrive.
const DEFAULT_LABELS = {
  repeat: "BT_attrRepeat", start: "BT_attrStart", defer: "BT_attrDefer", due: "BT_attrDue", completed: "BT_attrCompleted",
  project: "BT_attrProject", gtd: "BT_attrGTD", waitingFor: "BT_attrWaitingFor", context: "BT_attrContext",
  priority: "BT_attrPriority", energy: "BT_attrEnergy", depends: "BT_attrDepends", parent: "BT_attrParent", notes: "BT_attrNotes",
};
const DEFAULT_IDS = new Map(Object.entries(DEFAULT_LABELS).map(([id, label]) => [lower(label), id]));
let liveNames = null; // Map id -> Set of lower-case labels
let namesSig = "";

export function setTaskAttrNames(map) {
  liveNames = map instanceof Map && map.size ? map : null;
  namesSig = liveNames ? [...liveNames].map(([id, set]) => `${id}=${[...set].sort().join("|")}`).join(";") : "";
}
export const taskNamesSig = () => namesSig;

// The Better Tasks attribute id of a child string ("due", "project", ...), "other" for any other BT_attr* label, or null.
export function taskAttrId(text, names = liveNames) {
  // Better Tasks keeps a "**Activity log**" child on every task it edits. It is bookkeeping, not a subtask.
  if (String(text ?? "").trim() === ACTIVITY_LOG) return "activity";
  const name = attrNameOf(text);
  if (!name) return null;
  const key = lower(name);
  if (names) for (const [id, set] of names) if (set.has(key)) return id;
  if (DEFAULT_IDS.has(key)) return DEFAULT_IDS.get(key);
  return key.startsWith("bt_attr") ? "other" : null;
}

export function isTaskAttr(child, names = liveNames) {
  return taskAttrId(child?.[":block/string"] ?? child?.string ?? "", names) !== null;
}

const TASK_RE = /^\s*\{\{\[\[(TODO|DONE)\]\]\}\}/;
export const taskState = (string) => TASK_RE.exec(String(string ?? ""))?.[1] ?? "";
export const isTaskString = (string) => TASK_RE.test(String(string ?? ""));
// A task block that holds no text yet: the marker alone, a status tag at most.
export const isBareTask = (string) => isTaskString(string) && !String(string).replace(TASK_RE, "").replace(/#\[\[task-status\/[^\]]*\]\]/g, "").trim();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAILY_RE = new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);

export function parseRoamDay(title) {
  const m = DAILY_RE.exec(String(title ?? "").trim());
  if (!m) return null;
  const day = Number(m[2]);
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  if (m[3] !== suffix || day < 1 || day > 31) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  return { y: Number(m[4]), m: month + 1, d: day };
}

function childString(child) {
  return child?.[":block/string"] ?? child?.string ?? "";
}

function dayOf(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  return parseRoamDay(value);
}

function stamp(part) {
  return part.y * 10000 + part.m * 100 + part.d;
}

export function dueChip(content, today = new Date()) {
  let raw = null;
  let title = "";
  for (const child of content || []) {
    const text = String(childString(child));
    if (taskAttrId(text) !== "due") continue;
    raw = text;
    const rest = text.slice(text.indexOf("::") + 2).trim();
    const wiki = /^\[\[([\s\S]+)\]\]$/.exec(rest);
    title = (wiki ? wiki[1] : rest).trim();
    break;
  }
  if (raw == null || !title) return null;
  const due = parseRoamDay(title);
  const now = dayOf(today);
  return { text: title, overdue: Boolean(due && now && stamp(due) < stamp(now)), today: Boolean(due && now && stamp(due) === stamp(now)), raw, day: due };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(day, today = new Date()) {
  if (!day) return "";
  const now = dayOf(today);
  const base = `${SHORT_MONTHS[day.m - 1]} ${day.d}`;
  return now && day.y !== now.y ? `${base}, ${day.y}` : base;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const isoDay = iso;
// Quick picks for the due popover. Values are ISO days; Better Tasks turns them into its own date format.
export function dayChoices(today = new Date()) {
  const at = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const toMonday = ((8 - today.getDay()) % 7) || 7;
  return [
    { label: "Today", value: at(0) },
    { label: "Tomorrow", value: at(1) },
    { label: "Next week", value: at(toMonday) },
  ];
}

function attrValue(text) {
  const rest = String(text).slice(String(text).indexOf("::") + 2).trim();
  const ref = /\[\[([^\]]+)\]\]/.exec(rest);
  if (ref) return ref[1].trim();
  return rest.replace(/\{\{[\s\S]*$/, "").trim();
}

const PRIORITY_GLYPH = { low: "!", medium: "!!", high: "!!!" };
const STATUS_TAG = /#\[\[task-status\/([^\]]+)\]\]/;

// Everything a task card shows, or null when the block is not a task. Reads only.
export function taskMeta(string, content, today = new Date(), names = liveNames) {
  const state = taskState(string);
  if (!state) return null;
  const meta = { done: state === "DONE", status: "", cancelled: false, due: null, project: "", priority: "", priorityGlyph: "", repeat: "", waitingFor: "", gtd: "", energy: "", context: "", notes: "" };
  const tag = STATUS_TAG.exec(String(string));
  if (tag) { meta.status = tag[1].trim(); meta.cancelled = lower(meta.status) === "cancelled"; }
  const seen = new Set();
  for (const child of content || []) {
    const text = String(childString(child));
    const id = taskAttrId(text, names);
    if (!id || id === "other" || id === "activity" || seen.has(id)) continue;
    seen.add(id);
    const value = attrValue(text);
    if (!value) continue;
    if (id === "due") {
      const chip = dueChip([child], today);
      if (chip) meta.due = { text: chip.text, short: shortDay(chip.day, today), overdue: chip.overdue && !meta.done, today: chip.today };
    } else if (id === "priority") {
      meta.priority = lower(value);
      meta.priorityGlyph = PRIORITY_GLYPH[meta.priority] || "";
    } else if (id in meta) meta[id] = value;
  }
  return meta;
}
