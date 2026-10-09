// REG-1. Region and view blocks use the same macro as Roam Plexus.
// This file does not import that repo. img, view, and pdf are the kinds we support.
// Their kinds parse so a shared ((uid)) is recognised, and they stay unsupported here.

export const CONTAINER_STRING = "{{[[plexus-regions]]}}";
export const REGION_COMPONENT = "plexus-region";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;
const KNOWN_KEYS = new Set(["k", "d", "ids", "pad", "el", "f", "g", "fr", "p", "i", "v", "pg"]);
const ROAM_PLEXUS_KINDS = new Set(["area", "rect", "group", "frame", "cframe", "poly", "imgrect", "imgpoly"]);
const OURS = new Set(["img", "view", "pdf"]);
const DEFAULT_PAD = 10;
const MAX_IDS = 24;

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round4 = (n) => Math.round(n * 10000) / 10000;
const round1 = (n) => Math.round(n * 10) / 10;
const isId = (value) => typeof value === "string" && ID_RE.test(value);

export function isContainerString(s) {
  return typeof s === "string" && s.trim() === CONTAINER_STRING;
}

export function normalizeFrac(f) {
  let v;
  if (Array.isArray(f)) v = f;
  else if (f && typeof f === "object") {
    if ("rx" in f) v = [f.rx, f.ry, f.rw, f.rh];
    else if ("x" in f) v = [f.x, f.y, f.w, f.h];
  }
  if (!v || v.length !== 4) return null;
  const nums = v.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const out = nums.map((n) => round4(clamp01(n)));
  if (out[2] <= 0 || out[3] <= 0) return null;
  return out;
}

// World rect. One decimal. Width and height must stay above 0. Not clamped.
export function normalizeView(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const out = nums.map(round1);
  if (out[2] <= 0 || out[3] <= 0) return null;
  return out;
}

function childString(block) {
  return block?.[":block/string"] ?? block?.string ?? "";
}

function childList(block) {
  return block?.[":block/children"] || block?.children || [];
}

function propsType(block) {
  const props = block?.[":block/props"] || block?.props || {};
  const plexus = props[":plexus"] || props.plexus || {};
  return plexus[":type"] ?? plexus.type ?? "";
}

function fail(region, error) {
  region.error = error;
  region.supported = false;
  return region;
}

function parseIds(raw, cap) {
  const ids = String(raw).split(",");
  if (!ids.length || (cap && ids.length > MAX_IDS) || ids.some((id) => !isId(id))) return null;
  return ids;
}

export function parseRegion(blockString) {
  if (typeof blockString !== "string") return null;
  // The head token is the only match. Notes skip the expression.
  if (blockString.indexOf(REGION_COMPONENT) === -1) return null;
  const m = HEAD_RE.exec(blockString);
  if (!m) return null;
  const caption = (m[2] ?? "").trim();
  const args = new Map();
  const extra = [];
  const bad = [];
  for (const tok of m[1].split(/\s+/)) {
    if (!tok) continue;
    const eq = tok.indexOf("=");
    if (eq <= 0) { bad.push(tok); continue; }
    const key = tok.slice(0, eq);
    const value = tok.slice(eq + 1);
    if (KNOWN_KEYS.has(key) && !args.has(key)) args.set(key, value);
    else extra.push([key, value]);
  }
  const kind = args.get("k") ?? "";
  const drawingUid = args.get("d") ?? "";
  const region = { kind, drawingUid, caption, extra, supported: false, owner: "unknown" };
  if (bad.length) return fail(region, `bad token ${bad[0]}`);
  if (!kind) return fail(region, "missing k");

  if (OURS.has(kind)) {
    region.owner = "plexus-diagram";
    if (!drawingUid) return fail(region, "missing d");
    if (!isId(drawingUid)) return fail(region, "bad d");
    if (kind === "pdf") {
      if (!args.has("pg")) return fail(region, "missing pg");
      const rawPg = args.get("pg");
      if (!/^\d+$/.test(rawPg) || Number(rawPg) < 1) return fail(region, "bad pg");
      region.pg = Number(rawPg);
      if (!args.has("f")) return fail(region, "missing f");
      const parts = args.get("f").split(",");
      if (parts.length !== 4 || parts.some((x) => x.trim() === "")) return fail(region, "bad f");
      const f = normalizeFrac(parts.map(Number));
      if (!f) return fail(region, "bad f");
      region.f = f;
    } else if (kind === "img") {
      if (!args.has("f")) return fail(region, "missing f");
      const parts = args.get("f").split(",");
      if (parts.length !== 4 || parts.some((x) => x.trim() === "")) return fail(region, "bad f");
      const f = normalizeFrac(parts.map(Number));
      if (!f) return fail(region, "bad f");
      region.f = f;
    } else {
      if (!args.has("v")) return fail(region, "missing v");
      const parts = args.get("v").split(",");
      if (parts.length !== 4 || parts.some((x) => x.trim() === "")) return fail(region, "bad v");
      const v = normalizeView(parts.map(Number));
      if (!v) return fail(region, "bad v");
      region.v = v;
      if (args.has("ids")) {
        const ids = parseIds(args.get("ids"), true);
        if (!ids) return fail(region, "bad ids");
        region.ids = ids;
      }
    }
    region.supported = true;
    return region;
  }

  if (!ROAM_PLEXUS_KINDS.has(kind)) return fail(region, `unknown kind ${kind}`);
  region.owner = "roam-plexus";
  if (!drawingUid) return fail(region, "missing d");
  if (!isId(drawingUid)) return fail(region, "bad d");

  const parsePad = () => {
    if (!args.has("pad")) return DEFAULT_PAD;
    const raw = args.get("pad");
    const pad = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return pad >= 0 && pad <= 200 ? pad : null;
  };
  const takeId = (key, field) => {
    if (!args.has(key)) return `missing ${key}`;
    const v = args.get(key);
    if (!isId(v)) return `bad ${key}`;
    region[field] = v;
    return null;
  };
  const takeFrac = () => {
    if (!args.has("f")) return "missing f";
    const parts = args.get("f").split(",");
    if (parts.length !== 4 || parts.some((x) => x.trim() === "")) return "bad f";
    const f = normalizeFrac(parts.map(Number));
    if (!f) return "bad f";
    region.f = f;
    return null;
  };
  const takePoly = () => {
    if (!args.has("p")) return "missing p";
    const parts = args.get("p").split(",");
    if (parts.length < 6 || parts.length % 2) return "bad p";
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return "bad p";
    region.p = nums.map((n) => round4(clamp01(n)));
    return null;
  };
  const takeIndex = () => {
    if (!args.has("i")) return "missing i";
    const raw = args.get("i");
    if (!/^\d+$/.test(raw)) return "bad i";
    region.i = Number(raw);
    return null;
  };

  let err = null;
  if (kind === "area") {
    if (!args.has("ids")) return fail(region, "missing ids");
    const ids = parseIds(args.get("ids"), false);
    if (!ids) return fail(region, "bad ids");
    const pad = parsePad();
    if (pad === null) return fail(region, "bad pad");
    region.ids = ids;
    region.pad = pad;
  } else if (kind === "rect") {
    err = takeId("el", "el") || takeFrac();
  } else if (kind === "group") {
    err = takeId("g", "groupId");
    if (!err) {
      const pad = parsePad();
      if (pad === null) err = "bad pad";
      else region.pad = pad;
    }
  } else if (kind === "frame") {
    err = takeId("fr", "frameId");
    if (!err) {
      const pad = parsePad();
      if (pad === null) err = "bad pad";
      else region.pad = pad;
    }
  } else if (kind === "cframe") {
    err = takeId("fr", "frameId");
    if (!err && args.has("pad")) extra.unshift(["pad", args.get("pad")]);
  } else if (kind === "poly") {
    err = takeId("el", "el") || takePoly();
  } else if (kind === "imgrect") {
    err = takeIndex() || takeFrac();
  } else if (kind === "imgpoly") {
    err = takeIndex() || takePoly();
  }
  if (err) return fail(region, err);
  region.supported = false;
  return region;
}

function need(cond, msg) {
  if (!cond) throw new TypeError(`serializeRegion: ${msg}`);
}

export function serializeRegion(region) {
  need(region && typeof region === "object", "region required");
  const { kind, drawingUid } = region;
  need(OURS.has(kind) || ROAM_PLEXUS_KINDS.has(kind), `unknown kind ${kind}`);
  need(isId(drawingUid), "bad drawingUid");
  const tokens = [`k=${kind}`, `d=${drawingUid}`];
  if (kind === "pdf") {
    need(Number.isInteger(region.pg) && region.pg >= 1, "bad pg");
    const f = normalizeFrac(region.f);
    need(f, "bad f");
    tokens.push(`pg=${region.pg}`, `f=${f.join(",")}`);
  } else if (kind === "img") {
    const f = normalizeFrac(region.f);
    need(f, "bad f");
    tokens.push(`f=${f.join(",")}`);
  } else if (kind === "view") {
    const v = normalizeView(region.v);
    need(v, "bad v");
    tokens.push(`v=${v.join(",")}`);
    if (region.ids) {
      need(Array.isArray(region.ids) && region.ids.length > 0 && region.ids.length <= MAX_IDS && region.ids.every(isId), "bad ids");
      tokens.push(`ids=${region.ids.join(",")}`);
    }
  } else if (kind === "area") {
    need(Array.isArray(region.ids) && region.ids.length > 0 && region.ids.every(isId), "bad ids");
    const pad = region.pad ?? DEFAULT_PAD;
    need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
    tokens.push(`ids=${region.ids.join(",")}`, `pad=${pad}`);
  } else if (kind === "rect") {
    need(isId(region.el), "bad el");
    const f = normalizeFrac(region.f);
    need(f, "bad f");
    tokens.push(`el=${region.el}`, `f=${f.join(",")}`);
  } else if (kind === "group" || kind === "frame" || kind === "cframe") {
    const isGroup = kind === "group";
    const id = isGroup ? (region.groupId ?? region.g) : (region.frameId ?? region.fr);
    need(isId(id), isGroup ? "bad groupId" : "bad frameId");
    tokens.push(`${isGroup ? "g" : "fr"}=${id}`);
    if (kind !== "cframe") {
      const pad = region.pad ?? DEFAULT_PAD;
      need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
      tokens.push(`pad=${pad}`);
    }
  } else if (kind === "poly" || kind === "imgrect" || kind === "imgpoly") {
    if (kind === "poly") {
      need(isId(region.el), "bad el");
      tokens.push(`el=${region.el}`);
    } else {
      need(Number.isInteger(region.i) && region.i >= 0, "bad i");
      tokens.push(`i=${region.i}`);
    }
    if (kind === "imgrect") {
      const f = normalizeFrac(region.f);
      need(f, "bad f");
      tokens.push(`f=${f.join(",")}`);
    } else {
      need(Array.isArray(region.p) && region.p.length >= 6 && region.p.length % 2 === 0, "bad p");
      tokens.push(`p=${region.p.join(",")}`);
    }
  }
  for (const pair of region.extra ?? []) {
    need(Array.isArray(pair) && typeof pair[0] === "string" && /^[^\s=}]+$/.test(pair[0]) && /^[^\s}]*$/.test(String(pair[1])), "bad extra token");
    tokens.push(`${pair[0]}=${pair[1]}`);
  }
  const caption = String(region.caption ?? "").replace(/\s+/g, " ").trim();
  return `{{[[${REGION_COMPONENT}]]: ${tokens.join(" ")}}}${caption ? ` ${caption}` : ""}`;
}

export function fracRectOf(region) {
  const f = region?.f;
  if (!Array.isArray(f) || f.length !== 4) return null;
  return { rx: f[0], ry: f[1], rw: f[2], rh: f[3] };
}

export function viewRectOf(region) {
  const v = region?.v;
  if (!Array.isArray(v) || v.length !== 4) return null;
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

export function isStructuralString(s) {
  return isContainerString(s) || parseRegion(s) != null;
}

export function regionsOf(owner) {
  const container = childList(owner).find((child) => isContainerString(childString(child)) || propsType(child) === "regions");
  if (!container) return [];
  const out = [];
  for (const child of childList(container)) {
    const region = parseRegion(childString(child));
    if (!region) continue;
    const uid = child[":block/uid"] || child.uid;
    if (uid) region.uid = uid;
    out.push(region);
  }
  return out;
}
