import { attrNameOf, colorForLabel } from "./schema.js";

const MAX_SOURCES = 20;

export function linksQuery() {
  return `[:find ?a ?b ?su ?ss
 :in $ ?board [?a ...] [?b ...]
 :where
 [?src :block/refs ?b]
 (or [?src :block/page ?a] [?src :block/parents ?a] [(= ?src ?a)])
 [(not= ?a ?b)]
 (not [?src :block/parents ?board])
 [(not= ?src ?board)]
 [?src :block/uid ?su]
 [?src :block/string ?ss]]`;
}

function isBareAttr(s) {
  return typeof s === "string" && /^\s*[^:\n]{1,60}::\s*$/.test(s);
}

export function reduceLinks(rows, { eidToItems, parentStrings = new Map() } = {}) {
  const byKey = new Map();
  for (const [aEid, bEid, su, ss] of rows) {
    const froms = eidToItems.get(aEid) || [];
    const tos = eidToItems.get(bEid) || [];
    if (!froms.length || !tos.length) continue;
    let label = attrNameOf(ss);
    if (label == null) {
      const ps = parentStrings.get(su);
      if (isBareAttr(ps)) label = attrNameOf(ps);
    }
    const isAttr = label != null;
    if (!isAttr) label = "mentions";
    for (const from of froms) {
      for (const to of tos) {
        if (from === to) continue;
        const key = `${from}->${to}`;
        let link = byKey.get(key);
        if (!link) {
          link = { key, from, to, kind: "ref", labels: [], sources: [], color: "gray" };
          byKey.set(key, link);
        }
        if (isAttr) link.kind = "attr";
        if (!link.labels.includes(label)) link.labels.push(label);
        if (link.sources.length < MAX_SOURCES && !link.sources.some((s) => s.uid === su)) {
          link.sources.push({ uid: su, string: ss });
        }
      }
    }
  }
  const out = [];
  for (const link of byKey.values()) {
    link.labels = [
      ...link.labels.filter((l) => l !== "mentions"),
      ...link.labels.filter((l) => l === "mentions"),
    ];
    link.color = colorForLabel(link.labels[0]);
    out.push(link);
  }
  return out;
}

export function filterLinks(links, mode) {
  if (mode === "off") return [];
  if (mode === "attributes") return links.filter((l) => l.kind === "attr");
  return links;
}

export function coveredBy(links, board) {
  const pairs = new Map();
  for (const [uid, e] of board.edges) {
    for (const k of [`${e.from}->${e.to}`, `${e.to}->${e.from}`]) {
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(uid);
    }
  }
  const visible = [];
  const coveredEdges = new Set();
  for (const l of links) {
    const hit = pairs.get(`${l.from}->${l.to}`);
    if (hit) hit.forEach((u) => coveredEdges.add(u));
    else visible.push(l);
  }
  return { visible, coveredEdges };
}
