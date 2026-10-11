// Colour search for images. Pure: sRGB to OKLab, a small k-means palette, named colour anchors, and a score.
// The host decodes pixels (a 64x64 downscale) and calls colorPalette; nothing here touches the DOM.

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToOklab(r, g, b) {
  const lr = LIN[r & 255];
  const lg = LIN[g & 255];
  const lb = LIN[b & 255];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function chroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

// Below GRAY_CHROMA a colour reads as grey. A chromatic name needs palette entries above CHROMA_MIN.
const GRAY_CHROMA = 0.04;
const CHROMA_MIN = 0.035;
export const CLOSE_AT = 0.12;
export const HEX_OK = 0.2;
// Named chromatic colours are hue ranges in OKLCh: centre and half-width in degrees. Brown is the orange/red hue at low lightness.
const HUE_RANGES = {
  red: [25, 20], orange: [55, 18], yellow: [95, 18], green: [145, 35], teal: [195, 20], blue: [255, 30], purple: [300, 22], pink: [350, 18],
  brown: [50, 30],
};
const HUE_CHROMA_MIN = 0.05;
const BROWN_L_MAX = 0.55;
const BROWN_C_MAX = 0.14;
export const COLOR_MIN_SCORE = 0.15;

const ANCHOR_HEX = {
  red: "#e02020", orange: "#f08020", yellow: "#f0d020", green: "#30b030", teal: "#20a0a0", blue: "#2060e0",
  purple: "#8040c0", pink: "#f080b0", brown: "#8b5a2b", black: "#000000", white: "#ffffff", gray: "#808080",
};
export const COLOR_NAMES = Object.keys(ANCHOR_HEX);
export const COLOR_ANCHORS = Object.fromEntries(COLOR_NAMES.map((name) => {
  const rgb = hexToRgb(ANCHOR_HEX[name]);
  return [name, { name, hex: ANCHOR_HEX[name], lab: rgbToOklab(rgb[0], rgb[1], rgb[2]) }];
}));
COLOR_ANCHORS.grey = COLOR_ANCHORS.gray;

export function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (c) => {
    const v = Math.max(0, Math.min(1, c));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return toHex(enc(lin[0]), enc(lin[1]), enc(lin[2]));
}

// k-means over RGBA pixels. Skips near-transparent pixels. Deterministic: farthest-point start from the pixel nearest the mean.
export function colorPalette(rgba, { k = 5, iterations = 10 } = {}) {
  const n = Math.floor((rgba?.length || 0) / 4);
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (rgba[i * 4 + 3] < 128) continue;
    const lab = rgbToOklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    L[count] = lab[0];
    A[count] = lab[1];
    B[count] = lab[2];
    count += 1;
  }
  if (!count) return [];
  const kk = Math.min(k, count);
  let mL = 0; let mA = 0; let mB = 0;
  for (let i = 0; i < count; i += 1) { mL += L[i]; mA += A[i]; mB += B[i]; }
  mL /= count; mA /= count; mB /= count;
  const d2 = (i, l, a, b) => (L[i] - l) ** 2 + (A[i] - a) ** 2 + (B[i] - b) ** 2;
  let first = 0;
  let best = Infinity;
  for (let i = 0; i < count; i += 1) {
    const d = d2(i, mL, mA, mB);
    if (d < best) { best = d; first = i; }
  }
  const cl = [L[first]]; const ca = [A[first]]; const cb = [B[first]];
  const near = new Float32Array(count);
  for (let i = 0; i < count; i += 1) near[i] = d2(i, cl[0], ca[0], cb[0]);
  while (cl.length < kk) {
    let at = -1;
    let far = 1e-9;
    for (let i = 0; i < count; i += 1) if (near[i] > far) { far = near[i]; at = i; }
    if (at < 0) break;
    cl.push(L[at]); ca.push(A[at]); cb.push(B[at]);
    for (let i = 0; i < count; i += 1) near[i] = Math.min(near[i], d2(i, L[at], A[at], B[at]));
  }
  const m = cl.length;
  const owner = new Int32Array(count);
  const sums = new Float64Array(m * 4);
  for (let it = 0; it < iterations; it += 1) {
    sums.fill(0);
    let moved = 0;
    for (let i = 0; i < count; i += 1) {
      let bj = 0;
      let bd = Infinity;
      for (let j = 0; j < m; j += 1) {
        const d = d2(i, cl[j], ca[j], cb[j]);
        if (d < bd) { bd = d; bj = j; }
      }
      if (owner[i] !== bj) { owner[i] = bj; moved += 1; }
      sums[bj * 4] += L[i]; sums[bj * 4 + 1] += A[i]; sums[bj * 4 + 2] += B[i]; sums[bj * 4 + 3] += 1;
    }
    for (let j = 0; j < m; j += 1) {
      const c = sums[j * 4 + 3];
      if (!c) continue;
      cl[j] = sums[j * 4] / c; ca[j] = sums[j * 4 + 1] / c; cb[j] = sums[j * 4 + 2] / c;
    }
    if (!moved && it > 0) break;
  }
  sums.fill(0);
  for (let i = 0; i < count; i += 1) sums[owner[i] * 4 + 3] += 1;
  const out = [];
  for (let j = 0; j < m; j += 1) {
    const c = sums[j * 4 + 3];
    if (!c) continue;
    const lab = [cl[j], ca[j], cb[j]];
    out.push({ hex: oklabToHex(lab), lab: lab.map((v) => Math.round(v * 1000) / 1000), weight: Math.round((c / count) * 1000) / 1000 });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

// A query token as a colour target: a name or a #hex. null for any other word.
export function colorQuery(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  const named = COLOR_ANCHORS[t];
  if (named) {
    const achromatic = chroma(named.lab) < GRAY_CHROMA;
    return { name: named.name, hex: named.hex, lab: named.lab, achromatic, hue: achromatic ? null : HUE_RANGES[named.name] || null, token: t };
  }
  if (t.startsWith("#")) {
    const rgb = hexToRgb(t);
    if (!rgb) return null;
    const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
    return { name: "", hex: toHex(rgb[0], rgb[1], rgb[2]), lab, achromatic: chroma(lab) < GRAY_CHROMA, token: t };
  }
  return null;
}

function closeness(entry, target) {
  const c = chroma(entry.lab);
  if (target.achromatic) {
    if (c > 0.05) return 0;
    const d = Math.hypot(entry.lab[0] - target.lab[0], entry.lab[1], entry.lab[2]);
    return Math.max(0, 1 - d / (target.name === "gray" ? 0.25 : CLOSE_AT * 1.5));
  }
  if (target.hue) {
    if (c < HUE_CHROMA_MIN) return 0;
    const brown = target.name === "brown";
    if (brown && (entry.lab[0] >= BROWN_L_MAX || c > BROWN_C_MAX)) return 0;
    const h = ((Math.atan2(entry.lab[2], entry.lab[1]) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((h - target.hue[0] + 540) % 360) - 180);
    const hueScore = Math.max(0, 1 - diff / target.hue[1]);
    return hueScore * Math.min(1, (c - 0.03) / 0.08);
  }
  if (c < CHROMA_MIN) return 0;
  const d = Math.hypot(0.5 * (entry.lab[0] - target.lab[0]), entry.lab[1] - target.lab[1], entry.lab[2] - target.lab[2]);
  return Math.max(0, 1 - d / HEX_OK);
}

// Best palette entry: weight x closeness, 0 to 1.
export function colorScore(palette, target) {
  if (!Array.isArray(palette) || !target) return 0;
  let best = 0;
  for (let i = 0; i < palette.length; i += 1) {
    const e = palette[i];
    const s = e.weight * closeness(e, target);
    if (s > best) best = s;
  }
  return best;
}

// How far apart two palettes look: 0 for the same colours in the same shares, up to about 1 for black against white.
// Earth-mover-like: each palette's weights are scaled to sum to 1, then the closest pair of entries (OKLab distance)
// moves as much weight as both still hold, until all of it is placed. Share mismatch shows up as weight sent to a farther entry.
// Infinity when either palette is empty. Allocation-light: a few hundred float operations for two 5-colour palettes.
export function paletteDistance(a, b) {
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  const n = A.length;
  const m = B.length;
  if (!n || !m) return Infinity;
  const ra = new Float64Array(n);
  const rb = new Float64Array(m);
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) { ra[i] = Math.max(0, Number(A[i]?.weight) || 0); sa += ra[i]; }
  for (let j = 0; j < m; j += 1) { rb[j] = Math.max(0, Number(B[j]?.weight) || 0); sb += rb[j]; }
  if (!(sa > 0) || !(sb > 0)) return Infinity;
  for (let i = 0; i < n; i += 1) ra[i] /= sa;
  for (let j = 0; j < m; j += 1) rb[j] /= sb;
  const d = new Float64Array(n * m);
  for (let i = 0; i < n; i += 1) {
    const x = A[i].lab;
    for (let j = 0; j < m; j += 1) {
      const y = B[j].lab;
      d[i * m + j] = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    }
  }
  let cost = 0;
  for (let step = 0; step < n + m; step += 1) {
    let at = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (ra[i] <= 1e-12) continue;
      for (let j = 0; j < m; j += 1) {
        if (rb[j] <= 1e-12) continue;
        const v = d[i * m + j];
        if (v < best) { best = v; at = i * m + j; }
      }
    }
    if (at < 0) break;
    const i = Math.floor(at / m);
    const j = at % m;
    const move = Math.min(ra[i], rb[j]);
    cost += move * best;
    ra[i] -= move;
    rb[j] -= move;
  }
  return cost;
}
