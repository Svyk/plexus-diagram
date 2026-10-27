// PXD-10: a section bound to a tag (#reviewed) or an attribute (Status:: Review). Pure planning, no Roam calls.
// A card dropped in writes the tag onto its real block; dragged out removes it.

import { attrNameOf, classifyString } from "./schema.js";
import { isQueryString } from "./query.js";
import { columnNameOk } from "./table.js";
import { planKanbanMove } from "./kanban.js";

export const WRITE_CHUNK = 45;

const PLAIN_TAG = /^[\w\-/.]+$/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

function parseTag(text) {
  let m = /^#\[\[([^\]\n]+)\]\]$/.exec(text) || /^\[\[([^\]\n]+)\]\]$/.exec(text);
  let tag = m ? m[1].trim() : null;
  if (tag == null) {
    const bare = text.startsWith("#") ? text.slice(1) : text;
    if (!PLAIN_TAG.test(bare)) return null;
    tag = bare;
  }
  return tag ? { kind: "tag", tag } : null;
}

function parseAttr(text) {
  const name = attrNameOf(text);
  if (!name || !columnNameOk(name)) return null;
  const value = text.slice(text.indexOf("::") + 2).trim();
  return value ? { kind: "attr", name, value } : null;
}

export function parseBinding(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s) return null;
  if (s.includes("::")) return parseAttr(s);
  return parseTag(s);
}

export function readBinding(plexus) {
  const b = plexus?.bucket;
  if (!b || typeof b !== "object") return null;
  if (b.kind === "tag" && typeof b.tag === "string" && b.tag.trim()) return { kind: "tag", tag: b.tag.trim() };
  if (b.kind === "attr" && typeof b.name === "string" && typeof b.value === "string") return parseAttr(`${b.name}:: ${b.value}`);
  return null;
}

export function tagToken(tag) {
  return PLAIN_TAG.test(tag) ? `#${tag}` : `#[[${tag}]]`;
}

export function bindingLabel(b) {
  if (!b) return "";
  return b.kind === "tag" ? tagToken(b.tag) : `${b.name}:: ${b.value}`;
}

export function bindingKey(b) {
  return b.kind === "tag" ? `tag:${b.tag}` : `attr:${b.name}:${b.value}`;
}

const tagTail = "(?![\\w/.-])";
const plainRe = (tag, flags) => new RegExp(`(?<![\\w/.-])#${escapeRe(tag)}${tagTail}`, flags);

export function hasTag(string, tag) {
  const s = String(string ?? "");
  return plainRe(tag, "u").test(s) || s.includes(`#[[${tag}]]`) || s.includes(`[[${tag}]]`);
}

export function addTag(string, tag) {
  const s = String(string ?? "");
  if (hasTag(s, tag)) return s;
  return s ? `${s} ${tagToken(tag)}` : tagToken(tag);
}

// Takes the token and the space after it. A plain [[tag]] is content and stays.
export function removeTag(string, tag) {
  const s = String(string ?? "");
  const gone = new RegExp(`(?<![\\w/.-])#(?:\\[\\[${escapeRe(tag)}\\]\\]|${escapeRe(tag)}${tagTail}) ?`, "gu");
  return s.replace(gone, "").trimEnd();
}

// Raw child nodes to [{ name, value, uid }], the way tableRows reads them.
export function attrsOfKids(kids) {
  const out = [];
  for (const child of kids || []) {
    const string = String(child?.[":block/string"] ?? child?.string ?? "");
    const name = attrNameOf(string);
    if (!name || !columnNameOk(name)) continue;
    out.push({ name, value: string.slice(string.indexOf("::") + 2).trim(), uid: child?.[":block/uid"] ?? child?.uid ?? null });
  }
  return out;
}

// True when appending the tag would turn the card into another kind (an image or a query becomes a note).
export function tagBlocked(binding, string) {
  if (binding?.kind !== "tag" || hasTag(string, binding.tag)) return false;
  const before = String(string ?? "");
  const after = addTag(before, binding.tag);
  return classifyString(before).kind !== classifyString(after).kind || isQueryString(before) !== isQueryString(after);
}

export function planBucketAdd(binding, row) {
  if (!binding || !row?.uid) return null;
  if (binding.kind === "tag") {
    if (tagBlocked(binding, row.string)) return null;
    const string = addTag(row.string, binding.tag);
    return string === String(row.string ?? "") ? null : { op: "string", uid: row.uid, string };
  }
  return planKanbanMove({ field: binding.name, column: binding.value, row });
}

export function planBucketRemove(binding, row) {
  if (!binding || !row?.uid) return null;
  if (binding.kind === "tag") {
    const string = removeTag(row.string, binding.tag);
    return string === String(row.string ?? "") ? null : { op: "string", uid: row.uid, string };
  }
  const attr = (row.attrs || []).find((a) => a.name === binding.name);
  if (!attr?.uid || attr.value !== binding.value) return null;
  return { op: "delete", uid: attr.uid };
}

function applyPlan(row, plan) {
  if (plan.op === "string" && plan.uid === row.uid) return { ...row, string: plan.string };
  if (plan.op === "string") return { ...row, attrs: row.attrs.map((a) => (a.uid === plan.uid ? { ...a, value: plan.string.slice(plan.string.indexOf("::") + 2).trim() } : a)) };
  if (plan.op === "delete") return { ...row, attrs: row.attrs.filter((a) => a.uid !== plan.uid) };
  if (plan.op === "create") {
    const name = attrNameOf(plan.string);
    return { ...row, attrs: [...row.attrs, { name, value: plan.string.slice(plan.string.indexOf("::") + 2).trim(), uid: null, pending: true }] };
  }
  return row;
}

// before/after: bindings of the bound ancestor sections, innermost first. Plans in order, applied to a working copy
// of the row so two tag changes on one string leave one string op.
export function planChainChange(before, after, row) {
  const had = new Map((before || []).map((b) => [bindingKey(b), b]));
  const has = new Map((after || []).map((b) => [bindingKey(b), b]));
  const adds = [...has].filter(([k]) => !had.has(k)).map(([, b]) => b);
  const removes = [...had].filter(([k]) => !has.has(k)).map(([, b]) => b)
    .filter((b) => b.kind !== "attr" || !adds.some((a) => a.kind === "attr" && a.name === b.name));
  const plans = [];
  let work = { uid: row.uid, string: row.string ?? "", attrs: (row.attrs || []).map((a) => ({ ...a })) };
  const push = (plan) => {
    if (!plan) return;
    const last = plans.at(-1);
    if (plan.op === "string" && plan.uid === work.uid && last?.op === "string" && last.uid === plan.uid) last.string = plan.string;
    else plans.push(plan);
    work = applyPlan(work, plan);
  };
  for (const b of removes) push(planBucketRemove(b, work));
  for (const b of adds) push(planBucketAdd(b, work));
  return plans.filter((p) => !(p.op === "string" && p.uid === row.uid && p.string === String(row.string ?? "")));
}

export function chunk(list, n = WRITE_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
