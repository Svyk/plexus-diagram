// MEM-8 lenses. Paints stroke and dust classes. No writes and no listeners.

import { ageLabel, dustAge, dusty, explain, strengthScore, strokeFor } from "../model/strength.js";

const saved = new WeakMap();

function lineOf(el) {
  return el?.querySelector?.(".pxd-edge__line") || el;
}

function lookup(table, uid, index) {
  if (table == null) return undefined;
  if (typeof table.get === "function") {
    if (uid != null && table.has?.(uid)) return table.get(uid);
    if (typeof table.has !== "function" && uid != null && table.get(uid) != null) return table.get(uid);
  }
  if (Array.isArray(table)) return table[index];
  if (uid != null && typeof table === "object" && Object.prototype.hasOwnProperty.call(table, uid)) return table[uid];
  return undefined;
}

function uidOf(el) {
  return el?.getAttribute?.("data-uid") || el?.dataset?.uid || "";
}

function remember(el) {
  if (!el || saved.has(el)) return;
  saved.set(el, {
    strokeWidth: el.style?.strokeWidth || "",
    strokeOpacity: el.style?.strokeOpacity || "",
    title: el.hasAttribute?.("title") ? el.getAttribute("title") : null,
  });
}

function restore(el) {
  if (!el || !saved.has(el)) return;
  const prev = saved.get(el);
  saved.delete(el);
  if (el.style) {
    el.style.strokeWidth = prev.strokeWidth;
    el.style.strokeOpacity = prev.strokeOpacity;
  }
  if (prev.title == null) el.removeAttribute?.("title");
  else el.setAttribute?.("title", prev.title);
}

function dropTip(el) {
  const tips = el?.querySelectorAll?.(".pxd-strength__tip") || [];
  for (const tip of tips) tip.remove?.();
}

function putTip(el, text) {
  el.setAttribute?.("title", text);
  const doc = el.ownerDocument || globalThis.document;
  if (!doc?.createElement) return;
  let tip = el.querySelector?.(".pxd-strength__tip");
  if (!tip) {
    tip = doc.createElementNS?.("http://www.w3.org/2000/svg", "title") || doc.createElement("title");
    tip.setAttribute?.("class", "pxd-strength__tip");
    el.append?.(tip);
  }
  tip.textContent = text;
}

function partsOf(raw) {
  if (typeof raw === "number") return { score: raw, components: null };
  if (!raw || typeof raw !== "object") return { score: null, components: null };
  const components = raw.components && typeof raw.components === "object" ? { ...raw.components, now: raw.components.now ?? raw.now } : raw;
  const trackOpens = raw.trackOpens === true || components.trackOpens === true;
  const score = Number.isFinite(raw.score)
    ? raw.score
    : strengthScore(components, { trackOpens, now: components.now });
  return { score, components };
}

function lists(edges, cards) {
  if (edges && typeof edges === "object" && !Array.isArray(edges) && typeof edges.get !== "function"
    && (Object.prototype.hasOwnProperty.call(edges, "edges") || Object.prototype.hasOwnProperty.call(edges, "cards"))) {
    return { edges: edges.edges || [], cards: edges.cards || [] };
  }
  return { edges: edges || [], cards: cards || [] };
}

export function applyStrength(edgeEls, scores) {
  const list = [...(edgeEls || [])];
  list.forEach((el, index) => {
    if (!el) return;
    const raw = lookup(scores, uidOf(el), index);
    if (raw === undefined) return;
    const { score, components } = partsOf(raw);
    if (!Number.isFinite(score)) return;
    const stroke = strokeFor(score);
    const node = lineOf(el);
    remember(node);
    if (node !== el) remember(el);
    if (node?.style) {
      node.style.strokeWidth = `${stroke.width}px`;
      node.style.strokeOpacity = String(stroke.opacity);
    }
    if (components) {
      const text = `${explain(components)} Heuristic.`;
      putTip(el, text);
      if (node !== el) node?.setAttribute?.("title", text);
    }
  });
}

function dustItem(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return { editTime: 0, now: raw };
  return raw && typeof raw === "object" ? raw : null;
}

export function applyDust(cardEls, ages, period) {
  const list = [...(cardEls || [])];
  list.forEach((el, index) => {
    if (!el) return;
    const raw = lookup(ages, uidOf(el), index);
    const item = dustItem(raw);
    const on = item ? dusty(item, period) : false;
    if (!on) {
      el.classList?.remove("pxd-item--dust");
      el.removeAttribute?.("data-dust-age");
      dropTip(el);
      restore(el);
      return;
    }
    const age = typeof raw === "number"
      ? raw
      : dustAge(item.editTime ?? item.edit, item.createTime ?? item.create, Number.isFinite(item.now) ? item.now : Date.now());
    const label = ageLabel(age);
    remember(el);
    el.classList?.add("pxd-item--dust");
    el.setAttribute?.("data-dust-age", label);
    el.setAttribute?.("title", `Untouched for ${label}. Heuristic.`);
  });
}

export function clearLens(edges, cards) {
  const spec = lists(edges, cards);
  for (const el of spec.edges || []) {
    if (!el) continue;
    const node = lineOf(el);
    dropTip(el);
    if (node !== el) {
      dropTip(node);
      restore(node);
    }
    restore(el);
  }
  for (const el of spec.cards || []) {
    if (!el) continue;
    el.classList?.remove("pxd-item--dust");
    el.removeAttribute?.("data-dust-age");
    dropTip(el);
    restore(el);
  }
}
