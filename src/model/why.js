// Why notes on a connection. The note is the first child that is not an attribute.
// No Roam calls.

import { attrNameOf } from "./schema.js";

const flat = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export function readWhy(children) {
  for (const child of children || []) {
    const text = String(child?.[":block/string"] ?? child?.string ?? "").trim();
    if (!text || attrNameOf(text)) continue;
    return { uid: child?.[":block/uid"] || child?.uid || "", text };
  }
  return null;
}

export function becauseClause(text, max = 48) {
  const body = flat(text);
  if (!body) return "";
  const cut = body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body;
  return ` · because ${cut}`;
}

export function whyTip(text, max = 200) {
  const body = flat(text);
  if (!body) return "";
  return body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body;
}

// Label first, then the why child, so two native undos remove the why and then the label.
// An empty why adds no create. Clearing a stored why is a delete.
export function whyPlan({ label, why, prevLabel = "", prevWhy = "" } = {}) {
  const nextLabel = String(label ?? "").trim();
  const nextWhy = String(why ?? "").replace(/^\s+|\s+$/g, "");
  const prev = String(prevWhy ?? "").replace(/^\s+|\s+$/g, "");
  const ops = [];
  if (nextLabel !== String(prevLabel ?? "").trim()) ops.push({ op: "label", label: nextLabel });
  if (!nextWhy) {
    if (prev) ops.push({ op: "clear" });
    return ops;
  }
  if (nextWhy !== prev) ops.push({ op: "why", text: nextWhy });
  return ops;
}
