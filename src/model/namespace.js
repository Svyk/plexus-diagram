// RG-9. A page title `Project/Sub` offers a section titled `Project`.
// The first slash splits the parent from the rest. A title with no slash,
// a leading slash, or a trailing slash is not a namespace.

import { classifyString } from "./schema.js";

export function namespaceParent(title) {
  const name = String(title ?? "").trim();
  const slash = name.indexOf("/");
  if (slash <= 0 || slash >= name.length - 1) return null;
  return name.slice(0, slash);
}

// strings are the card strings a drop is about to write, in order.
// One parent across every namespaced page in the drop, or null.
export function dropNamespace(strings) {
  const hits = [];
  for (let i = 0; i < (strings || []).length; i++) {
    const cls = classifyString(strings[i]);
    if (cls.kind !== "page") continue;
    const parent = namespaceParent(cls.title);
    if (!parent) continue;
    hits.push({ i, parent });
  }
  if (!hits.length) return null;
  const parent = hits[0].parent;
  if (hits.some((hit) => hit.parent !== parent)) return null;
  return { parent, indexes: hits.map((hit) => hit.i) };
}
