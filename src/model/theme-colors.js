// Follow-Roam colour math. Pure: no DOM, no graph write. A bad sample returns null
// and the caller keeps the Plexus tokens.

export const BODY_CONTRAST = 4.5;
export const SURFACE_MIX = 0.04;

export const THEME_VARS = Object.freeze([
  "--pxd-link",
  "--pxd-surface",
  "--pxd-card",
  "--pxd-text",
  "--pxd-muted",
  "--pxd-border",
  "--pxd-border-strong",
  "--pxd-accent",
  "--pxd-accent-soft",
  "--pxd-edge",
  "--pxd-chrome-bg",
]);

function byte(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(255, Math.round(x)));
}

function alpha(n) {
  if (n == null || n === "") return 1;
  const raw = String(n).trim();
  const pct = raw.endsWith("%");
  const x = Number(pct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(x)) return null;
  const v = pct ? x / 100 : x;
  return Math.max(0, Math.min(1, v));
}

function hexByte(text) {
  const n = Number.parseInt(text, 16);
  return Number.isFinite(n) ? n : null;
}

function fromHex(text) {
  const hex = text.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const r = hexByte(hex[0] + hex[0]);
    const g = hexByte(hex[1] + hex[1]);
    const b = hexByte(hex[2] + hex[2]);
    const a = hex.length === 4 ? alpha(hexByte(hex[3] + hex[3]) / 255) : 1;
    if (r == null || g == null || b == null || a == null) return null;
    return { r, g, b, a };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = hexByte(hex.slice(0, 2));
    const g = hexByte(hex.slice(2, 4));
    const b = hexByte(hex.slice(4, 6));
    const a = hex.length === 8 ? alpha(hexByte(hex.slice(6, 8)) / 255) : 1;
    if (r == null || g == null || b == null || a == null) return null;
    return { r, g, b, a };
  }
  return null;
}

function hslToRgb(h, s, l, a) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, Number(s))) / 100;
  const lig = Math.max(0, Math.min(100, Number(l))) / 100;
  if (!Number.isFinite(hue) || !Number.isFinite(sat) || !Number.isFinite(lig)) return null;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = lig - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: a == null ? 1 : a,
  };
}

function fromFunc(text) {
  const match = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(text.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const parts = match[2].split(/[,\s/]+/).map((part) => part.trim()).filter(Boolean);
  if (kind === "rgb" || kind === "rgba") {
    if (parts.length < 3) return null;
    const r = byte(parts[0]);
    const g = byte(parts[1]);
    const b = byte(parts[2]);
    const a = alpha(parts[3]);
    if (r == null || g == null || b == null || a == null) return null;
    return { r, g, b, a };
  }
  if (parts.length < 3) return null;
  const s = String(parts[1]).replace("%", "");
  const l = String(parts[2]).replace("%", "");
  return hslToRgb(parts[0], s, l, alpha(parts[3]));
}

export function parseColor(input) {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  if (!text || text === "transparent") return null;
  if (text.startsWith("#")) return fromHex(text);
  if (text.startsWith("rgb") || text.startsWith("hsl")) return fromFunc(text);
  return null;
}

function channel(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(color) {
  const c = color && typeof color === "object" && "r" in color ? color : parseColor(color);
  if (!c) return 0;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a, b, t) {
  const from = typeof a === "string" ? parseColor(a) : a;
  const to = typeof b === "string" ? parseColor(b) : b;
  if (!from || !to) return null;
  const amount = Number.isFinite(Number(t)) ? Math.max(0, Math.min(1, Number(t))) : 0;
  return {
    r: Math.round(from.r * (1 - amount) + to.r * amount),
    g: Math.round(from.g * (1 - amount) + to.g * amount),
    b: Math.round(from.b * (1 - amount) + to.b * amount),
    a: from.a * (1 - amount) + to.a * amount,
  };
}

export function cssColor(color) {
  const c = color && typeof color === "object" ? color : parseColor(color);
  if (!c) return "";
  const r = byte(c.r);
  const g = byte(c.g);
  const b = byte(c.b);
  const a = alpha(c.a);
  if (r == null || g == null || b == null || a == null) return "";
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  const shown = Math.round(a * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${shown})`;
}

function opaque(color) {
  if (!color) return null;
  return { r: color.r, g: color.g, b: color.b, a: 1 };
}

function composite(fg, bg) {
  if (!fg || !bg) return null;
  const a = alpha(fg.a);
  if (a == null) return null;
  if (a >= 0.999) return opaque(fg);
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}



// Sample: { background, text, muted, border, link, dark }.
// Returns { dark, vars } or null when body text cannot hold 4.5:1.
export function deriveTheme(sample) {
  const src = sample && typeof sample === "object" ? sample : {};
  const background = parseColor(src.background);
  const text = parseColor(src.text);
  if (!background || !text || background.a < 0.5 || text.a <= 0) return null;
  const bg = opaque(background);
  const ink = composite(text, bg) || opaque(text);
  const dark = src.dark === true || luminance(bg) < 0.4;
  const card = mix(bg, ink, SURFACE_MIX);
  if (!card) return null;
  const cardOpaque = opaque(card);
  if (contrast(ink, cardOpaque) < BODY_CONTRAST || contrast(ink, bg) < BODY_CONTRAST) return null;

  let muted = parseColor(src.muted);
  const mutedOnCard = muted ? composite(muted, cardOpaque) : null;
  if (!mutedOnCard || contrast(mutedOnCard, cardOpaque) < 3) muted = mix(ink, bg, 0.4);

  let border = parseColor(src.border);
  if (!border || border.a < 0.2) border = mix(bg, ink, dark ? 0.28 : 0.18);
  const borderStrong = mix(border, ink, 0.35);

  let accent = parseColor(src.link);
  const accentOnCard = accent ? composite(accent, cardOpaque) : null;
  if (!accentOnCard || contrast(accentOnCard, cardOpaque) < 3) {
    accent = hslToRgb(175, dark ? 60 : 80, dark ? 55 : 30, 1);
  }
  const accentSoft = { ...opaque(accent), a: dark ? 0.22 : 0.18 };
  // Card links keep Roam's own link colour (the one an edited block shows) when it reads on the card.
  const linkSrc = parseColor(src.link);
  const linkOnCard = linkSrc ? composite(linkSrc, cardOpaque) : null;
  const link = linkOnCard && contrast(linkOnCard, cardOpaque) >= 3 ? opaque(linkSrc) : opaque(accent);

  const edge = mix(bg, ink, dark ? 0.55 : 0.45);
  const chrome = { ...cardOpaque, a: 0.96 };
  const vars = {
    "--pxd-surface": cssColor(bg),
    "--pxd-card": cssColor(cardOpaque),
    "--pxd-text": cssColor(ink),
    "--pxd-muted": cssColor(opaque(muted)),
    "--pxd-border": cssColor(opaque(border)),
    "--pxd-border-strong": cssColor(opaque(borderStrong)),
    "--pxd-accent": cssColor(opaque(accent)),
    "--pxd-link": cssColor(link),
    "--pxd-accent-soft": cssColor(accentSoft),
    "--pxd-edge": cssColor(opaque(edge)),
    "--pxd-chrome-bg": cssColor(chrome),
  };
  return { dark, vars };
}

export function applyThemeVars(style, vars) {
  if (!style || typeof style.setProperty !== "function") return;
  if (!vars || typeof vars !== "object") {
    for (const name of THEME_VARS) {
      try { style.removeProperty(name); } catch { /* stub */ }
    }
    return;
  }
  for (const name of THEME_VARS) {
    const value = vars[name];
    try {
      if (typeof value === "string" && value) style.setProperty(name, value);
      else style.removeProperty(name);
    } catch { /* stub */ }
  }
}
