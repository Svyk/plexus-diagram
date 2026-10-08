// RGB image ops shared by the browser worker and the node bench. rgb is Uint8Array, row-major, 3 channels.

export function resizeRgb(rgb, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return { rgb, w: dw, h: dh };
  const out = new Uint8Array(dw * dh * 3);
  const x0s = new Int32Array(dw);
  const x1s = new Int32Array(dw);
  const xw = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = (x + 0.5) * sw / dw - 0.5;
    const x0 = Math.max(0, Math.floor(fx));
    x0s[x] = x0;
    x1s[x] = Math.min(sw - 1, x0 + 1);
    xw[x] = fx - x0;
  }
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sh / dh - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    const row0 = y0 * sw;
    const row1 = y1 * sw;
    const dest = y * dw;
    for (let x = 0; x < dw; x++) {
      const wx = xw[x];
      const i = (dest + x) * 3;
      const a = (row0 + x0s[x]) * 3;
      const b = (row0 + x1s[x]) * 3;
      const c = (row1 + x0s[x]) * 3;
      const d = (row1 + x1s[x]) * 3;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;
      out[i] = (rgb[a] * w00 + rgb[b] * w10 + rgb[c] * w01 + rgb[d] * w11 + 0.5) | 0;
      out[i + 1] = (rgb[a + 1] * w00 + rgb[b + 1] * w10 + rgb[c + 1] * w01 + rgb[d + 1] * w11 + 0.5) | 0;
      out[i + 2] = (rgb[a + 2] * w00 + rgb[b + 2] * w10 + rgb[c + 2] * w01 + rgb[d + 2] * w11 + 0.5) | 0;
    }
  }
  return { rgb: out, w: dw, h: dh };
}

export function cropRgb(rgb, w, h, x0, y0, x1, y1) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w, Math.ceil(x1));
  const yb = Math.min(h, Math.ceil(y1));
  const cw = Math.max(0, xb - xa);
  const ch = Math.max(0, yb - ya);
  if (!cw || !ch) return { rgb: new Uint8Array(0), w: 0, h: 0 };
  const out = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    const src = ((ya + y) * w + xa) * 3;
    out.set(rgb.subarray(src, src + cw * 3), y * cw * 3);
  }
  return { rgb: out, w: cw, h: ch };
}

export function grayFromRgb(rgb, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const o = i * 3;
    out[i] = (rgb[o] * 0.299 + rgb[o + 1] * 0.587 + rgb[o + 2] * 0.114 + 0.5) | 0;
  }
  return out;
}

export function padWhite(rgb, w, h, pad) {
  if (!pad) return { rgb, w, h };
  const dw = w + pad * 2;
  const dh = h + pad * 2;
  const out = new Uint8Array(dw * dh * 3);
  out.fill(255);
  for (let y = 0; y < h; y++) {
    const src = y * w * 3;
    out.set(rgb.subarray(src, src + w * 3), ((y + pad) * dw + pad) * 3);
  }
  return { rgb: out, w: dw, h: dh };
}

// (pixel / 255 - 0.5) / 0.5, NCHW. White is 1, black is -1.
export function nchwNormalize(rgb, w, h) {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const o = i * 3;
    out[i] = (rgb[o] / 255 - 0.5) / 0.5;
    out[plane + i] = (rgb[o + 1] / 255 - 0.5) / 0.5;
    out[2 * plane + i] = (rgb[o + 2] / 255 - 0.5) / 0.5;
  }
  return out;
}

function round32(n) {
  return Math.max(32, Math.round(n / 32) * 32);
}

// Long side limited, both sides a multiple of 32. Returns the resized RGB.
export function detResize(rgb, w, h, limit = 960) {
  const long = Math.max(w, h);
  const ratio = long > limit ? limit / long : 1;
  const dw = round32(w * ratio);
  const dh = round32(h * ratio);
  return resizeRgb(rgb, w, h, dw, dh);
}

// Recogniser input: height 48, width rounded up to a multiple of 8 with white on the right.
export function recResize(rgb, w, h, targetH = 48) {
  const ratio = w / Math.max(1, h);
  const contentW = Math.max(8, Math.ceil(targetH * ratio));
  const resized = resizeRgb(rgb, w, h, contentW, targetH);
  const pad = (8 - (contentW % 8)) % 8;
  if (!pad) return { rgb: resized.rgb, w: contentW, h: targetH, contentW };
  const dw = contentW + pad;
  const out = new Uint8Array(targetH * dw * 3);
  out.fill(255);
  for (let y = 0; y < targetH; y++) {
    out.set(resized.rgb.subarray(y * contentW * 3, (y + 1) * contentW * 3), y * dw * 3);
  }
  return { rgb: out, w: dw, h: targetH, contentW };
}

function rotateQuarter(rgb, w, h, turns) {
  let src = rgb;
  let sw = w;
  let sh = h;
  for (let t = 0; t < turns; t++) {
    const dw = sh;
    const dh = sw;
    const out = new Uint8Array(dw * dh * 3);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const nx = y;
        const ny = sw - 1 - x;
        const s = (y * sw + x) * 3;
        const d = (ny * dw + nx) * 3;
        out[d] = src[s];
        out[d + 1] = src[s + 1];
        out[d + 2] = src[s + 2];
      }
    }
    src = out;
    sw = dw;
    sh = dh;
  }
  return { rgb: src, w: sw, h: sh };
}

// Positive degrees rotate the image counter-clockwise on screen (y grows downward).
// A small angle keeps the canvas size and fills the corners white. 90-degree turns swap axes.
export function rotateRgb(rgb, w, h, degreesCcw) {
  if (!Number.isFinite(degreesCcw) || Math.abs(degreesCcw) < 0.05) return { rgb, w, h };
  const quarter = Math.round(degreesCcw / 90);
  if (Math.abs(degreesCcw - quarter * 90) < 0.05 && quarter % 4 !== 0) {
    return rotateQuarter(rgb, w, h, ((quarter % 4) + 4) % 4);
  }
  const rad = degreesCcw * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const out = new Uint8Array(w * h * 3);
  out.fill(255);
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const fx = cx + dx * cos - dy * sin;
      const fy = cy + dx * sin + dy * cos;
      if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) continue;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const wx = fx - x0;
      const wy = fy - y0;
      const xa = Math.max(0, x0);
      const ya = Math.max(0, y0);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const i = (y * w + x) * 3;
      const a = (ya * w + xa) * 3;
      const b = (ya * w + x1) * 3;
      const c = (y1 * w + xa) * 3;
      const d = (y1 * w + x1) * 3;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;
      out[i] = (rgb[a] * w00 + rgb[b] * w10 + rgb[c] * w01 + rgb[d] * w11 + 0.5) | 0;
      out[i + 1] = (rgb[a + 1] * w00 + rgb[b + 1] * w10 + rgb[c + 1] * w01 + rgb[d + 1] * w11 + 0.5) | 0;
      out[i + 2] = (rgb[a + 2] * w00 + rgb[b + 2] * w10 + rgb[c + 2] * w01 + rgb[d + 2] * w11 + 0.5) | 0;
    }
  }
  return { rgb: out, w, h };
}
