// src/model/ocr/manifest.js
function dictLines(text) {
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
}

// src/model/ocr/components.js
function labelComponents(mask, width, height) {
  const n = width * height;
  const labels = new Int32Array(n);
  const parent = [0];
  let next = 1;
  const find = (a) => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== a) {
      const p = parent[a];
      parent[a] = root;
      a = p;
    }
    return root;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const up = row - width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (!mask[i]) continue;
      let best = 0;
      const consider = (lab) => {
        if (!lab) return;
        lab = find(lab);
        if (!best) best = lab;
        else if (lab !== best) unite(best, lab);
      };
      if (x > 0) consider(labels[i - 1]);
      if (y > 0) {
        consider(labels[up + x]);
        if (x > 0) consider(labels[up + x - 1]);
        if (x + 1 < width) consider(labels[up + x + 1]);
      }
      if (!best) {
        parent[next] = next;
        labels[i] = next++;
      } else labels[i] = find(best);
    }
  }
  const acc = /* @__PURE__ */ new Map();
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const lab = labels[row + x];
      if (!lab) continue;
      const root = find(lab);
      labels[row + x] = root;
      let c = acc.get(root);
      if (!c) {
        c = { area: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
        acc.set(root, c);
      }
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x > c.x1) c.x1 = x;
      if (y > c.y1) c.y1 = y;
      c.sx += x;
      c.sy += y;
      c.sxx += x * x;
      c.syy += y * y;
      c.sxy += x * y;
    }
  }
  const out = [];
  for (const c of acc.values()) {
    const mx = c.sx / c.area;
    const my = c.sy / c.area;
    const cxx = c.sxx / c.area - mx * mx;
    const cyy = c.syy / c.area - my * my;
    const cxy = c.sxy / c.area - mx * my;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;
    out.push({ ...c, angle });
  }
  return out;
}

// src/model/ocr/db-boxes.js
function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}
function boxesFromProb(prob, mapW, mapH, srcW, srcH, opts = {}) {
  const thresh = opts.thresh ?? 0.3;
  const boxThresh = opts.boxThresh ?? 0.6;
  const unclipRatio = opts.unclipRatio ?? 1.5;
  const minSide = opts.minSide ?? 3;
  const maxBoxes = opts.maxBoxes ?? 1e3;
  if (!prob || mapW < 2 || mapH < 2) return [];
  const mask = new Uint8Array(mapW * mapH);
  for (let i = 0; i < mask.length; i++) if (prob[i] >= thresh) mask[i] = 1;
  const sx = srcW / mapW;
  const sy = srcH / mapH;
  const raw = [];
  for (const c of labelComponents(mask, mapW, mapH)) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    if (bw < minSide || bh < minSide) continue;
    let sum = 0;
    let n = 0;
    for (let y = c.y0; y <= c.y1; y++) {
      const row = y * mapW;
      for (let x = c.x0; x <= c.x1; x++) {
        sum += prob[row + x];
        n++;
      }
    }
    const score = n ? sum / n : 0;
    if (score < boxThresh) continue;
    const peri = 2 * (bw + bh);
    const d = peri > 0 ? bw * bh * unclipRatio / peri : 0;
    let x0 = (c.x0 - d) * sx;
    let y0 = (c.y0 - d) * sy;
    let x1 = (c.x1 + 1 + d) * sx;
    let y1 = (c.y1 + 1 + d) * sy;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(srcW, x1);
    y1 = Math.min(srcH, y1);
    if (x1 - x0 < minSide || y1 - y0 < minSide) continue;
    if (x1 - x0 > 0.98 * srcW && y1 - y0 > 0.5 * srcH) continue;
    raw.push({ x0, y0, x1, y1, score, angle: c.angle });
  }
  raw.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of raw) {
    if (kept.length >= maxBoxes) break;
    if (kept.some((other) => iou(other, box) > 0.5)) continue;
    kept.push(box);
  }
  return kept;
}
function dominantAngle(boxes) {
  const wide = [];
  for (const box of boxes || []) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w > 3 * h && w > 30 && Math.abs(box.angle) <= 20) wide.push({ a: box.angle, w });
  }
  if (!wide.length) return 0;
  wide.sort((p, q) => p.a - q.a);
  const total = wide.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  for (const row of wide) {
    acc += row.w;
    if (acc >= total / 2) return row.a;
  }
  return wide[wide.length - 1].a;
}

// src/model/ocr/image.js
function resizeRgb(rgb, sw, sh, dw, dh) {
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
      out[i] = rgb[a] * w00 + rgb[b] * w10 + rgb[c] * w01 + rgb[d] * w11 + 0.5 | 0;
      out[i + 1] = rgb[a + 1] * w00 + rgb[b + 1] * w10 + rgb[c + 1] * w01 + rgb[d + 1] * w11 + 0.5 | 0;
      out[i + 2] = rgb[a + 2] * w00 + rgb[b + 2] * w10 + rgb[c + 2] * w01 + rgb[d + 2] * w11 + 0.5 | 0;
    }
  }
  return { rgb: out, w: dw, h: dh };
}
function cropRgb(rgb, w, h, x0, y0, x1, y1) {
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
function grayFromRgb(rgb, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const o = i * 3;
    out[i] = rgb[o] * 0.299 + rgb[o + 1] * 0.587 + rgb[o + 2] * 0.114 + 0.5 | 0;
  }
  return out;
}
function padWhite(rgb, w, h, pad) {
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
function nchwNormalize(rgb, w, h) {
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
function detResize(rgb, w, h, limit = 960) {
  const long = Math.max(w, h);
  const ratio = long > limit ? limit / long : 1;
  const dw = round32(w * ratio);
  const dh = round32(h * ratio);
  return resizeRgb(rgb, w, h, dw, dh);
}
function recResize(rgb, w, h, targetH = 48) {
  const ratio = w / Math.max(1, h);
  const contentW = Math.max(8, Math.ceil(targetH * ratio));
  const resized = resizeRgb(rgb, w, h, contentW, targetH);
  const pad = (8 - contentW % 8) % 8;
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
function rotateRgb(rgb, w, h, degreesCcw) {
  if (!Number.isFinite(degreesCcw) || Math.abs(degreesCcw) < 0.05) return { rgb, w, h };
  const quarter = Math.round(degreesCcw / 90);
  if (Math.abs(degreesCcw - quarter * 90) < 0.05 && quarter % 4 !== 0) {
    return rotateQuarter(rgb, w, h, (quarter % 4 + 4) % 4);
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
      out[i] = rgb[a] * w00 + rgb[b] * w10 + rgb[c] * w01 + rgb[d] * w11 + 0.5 | 0;
      out[i + 1] = rgb[a + 1] * w00 + rgb[b + 1] * w10 + rgb[c + 1] * w01 + rgb[d + 1] * w11 + 0.5 | 0;
      out[i + 2] = rgb[a + 2] * w00 + rgb[b + 2] * w10 + rgb[c + 2] * w01 + rgb[d + 2] * w11 + 0.5 | 0;
    }
  }
  return { rgb: out, w, h };
}

// src/model/ocr/rules-from-canvas.js
function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let thresh = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between >= max) {
      max = between;
      thresh = t;
    }
  }
  return thresh;
}
function inkMask(gray, width, height) {
  const thresh = otsuThreshold(gray);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) if (gray[i] <= thresh) mask[i] = 1;
  return mask;
}
function morph1d(mask, width, height, length, horizontal, dilate) {
  const out = new Uint8Array(width * height);
  if (length <= 1) {
    out.set(mask);
    return out;
  }
  const anchor = Math.floor((length - 1) / 2);
  if (horizontal) {
    const prefix2 = new Uint32Array(width + 1);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) prefix2[x + 1] = prefix2[x] + mask[row + x];
      for (let x = 0; x < width; x++) {
        const a = x - anchor;
        const b = a + length - 1;
        if (a < 0 || b >= width) continue;
        const count = prefix2[b + 1] - prefix2[a];
        out[row + x] = dilate ? count > 0 ? 1 : 0 : count === length ? 1 : 0;
      }
    }
    return out;
  }
  const prefix = new Uint32Array(height + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + mask[y * width + x];
    for (let y = 0; y < height; y++) {
      const a = y - anchor;
      const b = a + length - 1;
      if (a < 0 || b >= height) continue;
      const count = prefix[b + 1] - prefix[a];
      out[y * width + x] = dilate ? count > 0 ? 1 : 0 : count === length ? 1 : 0;
    }
  }
  return out;
}
function open1d(mask, width, height, length, horizontal) {
  return morph1d(morph1d(mask, width, height, length, horizontal, false), width, height, length, horizontal, true);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function rulesFromCanvas(gray, width, height, scale, { minLenPt = 18 } = {}) {
  if (!gray || width < 8 || height < 8 || !(scale > 0)) return [];
  const ink = inkMask(gray, width, height);
  const minLen = Math.max(8, Math.round(minLenPt * scale));
  const maxThick = Math.max(6, 4 * scale);
  const out = [];
  const axes = [
    ["h", Math.max(20, Math.floor(width / 60))],
    ["v", Math.max(20, Math.floor(height / 60))]
  ];
  for (const [axis, kernel] of axes) {
    const horizontal = axis === "h";
    let opened = open1d(ink, width, height, kernel, horizontal);
    const bridge = Math.max(1, Math.floor(kernel / 2));
    opened = morph1d(opened, width, height, bridge, horizontal, true);
    opened = morph1d(opened, width, height, bridge, horizontal, false);
    for (const c of labelComponents(opened, width, height)) {
      const bw = c.x1 - c.x0 + 1;
      const bh = c.y1 - c.y0 + 1;
      const length = horizontal ? bw : bh;
      const thick = horizontal ? bh : bw;
      if (length < minLen || thick > maxThick) continue;
      if (horizontal) {
        out.push({
          x0: round2(c.x0 / scale),
          y0: round2((c.y0 + bh / 2) / scale),
          x1: round2((c.x1 + 1) / scale),
          y1: round2((c.y0 + bh / 2) / scale),
          thick: round2(bh / scale)
        });
      } else {
        out.push({
          x0: round2((c.x0 + bw / 2) / scale),
          y0: round2(c.y0 / scale),
          x1: round2((c.x0 + bw / 2) / scale),
          y1: round2((c.y1 + 1) / scale),
          thick: round2(bw / scale)
        });
      }
    }
  }
  out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return out;
}
function inkGlyph(gray, width, height) {
  if (!gray || width < 2 || height < 2) return null;
  const ink = inkMask(gray, width, height);
  const marks = [];
  for (const c of labelComponents(ink, width, height)) {
    const bw2 = c.x1 - c.x0 + 1;
    const bh2 = c.y1 - c.y0 + 1;
    if (bw2 >= 0.8 * width || bh2 >= 0.8 * height) continue;
    if (c.area < 16 || bw2 <= 4 && bh2 <= 5) continue;
    if (c.y1 >= height - 2 && bh2 <= 0.3 * height) continue;
    marks.push({ bw: bw2, bh: bh2, area: c.area });
  }
  if (marks.length !== 1) return null;
  const { bw, bh, area } = marks[0];
  if (bw >= 3 * bh && bw >= 8 && bh <= 0.3 * height && area >= 0.6 * bw * bh) return "\u2014";
  if (bw / Math.max(1, bh) >= 0.6 && bw / Math.max(1, bh) <= 1.6 && bw <= 0.5 * height && bh <= 0.5 * height && bw >= 5) return "*";
  return null;
}

// src/model/ocr/words-from-ctc.js
var SPACE = /* @__PURE__ */ new Set([" ", "\u3000", "\xA0"]);
function round22(n) {
  return Math.round(n * 100) / 100;
}
function round3(n) {
  return Math.round(n * 1e3) / 1e3;
}
function softmaxAt(logits, row, classes, index) {
  let max = -Infinity;
  for (let c = 0; c < classes; c++) max = Math.max(max, logits[row + c]);
  let sum = 0;
  for (let c = 0; c < classes; c++) sum += Math.exp(logits[row + c] - max);
  return Math.exp(logits[row + index] - max) / sum;
}
function confidenceAt(logits, row, classes, index) {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < classes; c++) {
    const v = logits[row + c];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min >= -1e-4 && max <= 1.001 && sum > 0.95 && sum < 1.05) return Math.max(0, logits[row + index]);
  return softmaxAt(logits, row, classes, index);
}
function ctcDecode(logits, time, classes, dict2) {
  const chars = [];
  let prev = -1;
  for (let t = 0; t < time; t++) {
    const row = t * classes;
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = logits[row + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      const ch = best <= dict2.length ? dict2[best - 1] : best === dict2.length + 1 ? " " : null;
      if (ch) chars.push({ ch, t, conf: confidenceAt(logits, row, classes, best) });
    }
    prev = best;
  }
  return chars;
}
function bucketConf(mean) {
  if (mean >= 0.8) return 1;
  if (mean >= 0.5) return 0.5;
  return 0.3;
}
function softenPhrase(text) {
  return String(text || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/,(\S)/g, ", $1").replace(/;(\S)/g, "; $1").replace(/(\S)\(/g, "$1 (").replace(/\)([A-Za-z])/g, ") $1");
}
function wordItem(text, x0, x1, box, conf) {
  const width = Math.max(0.4, x1 - x0);
  const size = Math.max(0.5, box.y1 - box.y0);
  const base = box.y1 - 0.2 * size;
  const sized = round22(size);
  return {
    str: text,
    transform: [sized, 0, 0, sized, round22(x0), round22(base)],
    width: round22(width),
    height: sized,
    y0: round22(base - 0.8 * sized),
    y1: round22(base + 0.22 * sized),
    fontName: "ocr",
    conf: bucketConf(conf),
    mean: round3(conf)
  };
}
function ctcText({ logits, time, classes, dict: dict2 }) {
  const chars = ctcDecode(logits, time, classes, dict2);
  if (!chars.length) return { text: "", conf: 0 };
  let raw = "";
  let conf = 0;
  let n = 0;
  for (const ch of chars) {
    if (SPACE.has(ch.ch)) raw += " ";
    else {
      raw += ch.ch;
      conf += ch.conf;
      n++;
    }
  }
  raw = raw.replace(/\s+/g, " ").trim();
  const text = /[A-Za-z]/.test(raw) ? softenPhrase(raw) : raw;
  return { text, conf: n ? Math.round(conf / n * 1e3) / 1e3 : 0 };
}
function wordsFromCtc({ logits, time, classes, dict: dict2, box }) {
  const chars = ctcDecode(logits, time, classes, dict2);
  if (!chars.length || !box) return [];
  const span = Math.max(0.4, box.x1 - box.x0);
  const groups = [];
  let cur = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const ch of chars) {
    if (SPACE.has(ch.ch)) flush();
    else cur.push(ch);
  }
  flush();
  if (!groups.length) return [];
  if (groups.length === 1 && !chars.some((ch) => SPACE.has(ch.ch))) {
    const text = groups[0].map((ch) => ch.ch).join("");
    const parts = softenPhrase(text).split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      const conf2 = groups[0].reduce((s, ch) => s + ch.conf, 0) / groups[0].length;
      return text ? [wordItem(text, box.x0, box.x1, box, conf2)] : [];
    }
    const total = parts.reduce((s, p) => s + p.length, 0);
    let x = box.x0;
    const conf = groups[0].reduce((s, ch) => s + ch.conf, 0) / groups[0].length;
    return parts.map((part) => {
      const w = span * (part.length / total);
      const item = wordItem(part, x, x + w, box, conf);
      x += w;
      return item;
    });
  }
  return groups.map((group) => {
    const text = group.map((ch) => ch.ch).join("");
    const t0 = group[0].t;
    const t1 = group[group.length - 1].t + 1;
    const x0 = box.x0 + t0 / time * span;
    const x1 = box.x0 + t1 / time * span;
    const conf = group.reduce((s, ch) => s + ch.conf, 0) / group.length;
    return wordItem(text, x0, x1, box, conf);
  }).filter((item) => item.str);
}
var TALL_RE = /[A-Z0-9bdfhklt]/;
var DESC_RE = /[gjpqy,;()[\]{}|/_@]/;
var NUMBERISH_RE = /^[\d.,()%+\-–—OoDQBSslIZG|]+$/;
var ECHO_RE = /^(?:c+|y[aeinm]{0,6}|ge|gae)$/i;
function withoutEchoes(items) {
  const kept = [];
  for (const item of items) {
    const mean = item.mean;
    delete item.mean;
    if (ECHO_RE.test(item.str) && !(mean >= 0.92)) continue;
    kept.push(item);
  }
  return kept;
}
function bodySizeOf(items) {
  const wordy = items.filter((item) => item.str.length >= 3 || /\d/.test(item.str));
  const source = wordy.length >= 4 ? wordy : items;
  const plain = source.filter((item) => TALL_RE.test(item.str) && !DESC_RE.test(item.str));
  const pool = (plain.length ? plain : source).map((item) => item.transform[0]).sort((a, b) => a - b);
  const median = pool[pool.length >> 1] || items[0].transform[0];
  let body = median;
  const sorted = items.map((item) => item.transform[5]).sort((a, b) => a - b);
  const bases = [];
  for (const base of sorted) {
    if (!bases.length || base - bases[bases.length - 1] > 0.35 * median) bases.push(base);
  }
  const gaps = [];
  for (let i = 1; i < bases.length; i++) {
    const gap = bases[i] - bases[i - 1];
    if (gap > 0.4 * median && gap < 2.5 * median) gaps.push(gap);
  }
  if (gaps.length >= 4) {
    gaps.sort((a, b) => a - b);
    const pitch = gaps[gaps.length >> 1];
    if (pitch < 0.7 * median) body = pitch / 0.95;
  }
  return { body, median };
}
function snapOcrItems(items) {
  if (!items.length) return [];
  items = withoutEchoes(items);
  if (!items.length) return [];
  const { body, median } = bodySizeOf(items);
  const kept = [];
  for (const item of items) {
    const size = item.transform[0];
    if (size < 0.45 * median && !(item.conf >= 1 && NUMBERISH_RE.test(item.str))) continue;
    if (size >= 0.45 * median && size <= 1.5 * median && body > 0) {
      const base = item.transform[5];
      const sized = round22(body);
      item.transform[0] = sized;
      item.transform[3] = sized;
      item.height = sized;
      item.y0 = round22(base - 0.8 * sized);
      item.y1 = round22(base + 0.22 * sized);
    }
    kept.push(item);
  }
  kept.sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  let anchor = null;
  for (const item of kept) {
    const base = item.transform[5];
    const size = item.transform[0] || 1;
    if (anchor == null || base - anchor > 0.3 * size) anchor = base;
    const shift = anchor - base;
    item.transform[5] = round22(anchor);
    item.y0 = round22(item.y0 + shift);
    item.y1 = round22(item.y1 + shift);
  }
  kept.sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  return kept;
}

// src/model/ocr/recognize.js
var DET_LIMIT = 960;
var REC_H = 48;
var BATCH = 8;
var CLEAN_NUM = /^\d{1,4}(?:\.\d+)?$/;
var LONG_WORD = /^[A-Za-z][A-Za-z,.'()\-]{4,}$/;
var CELL_PAD_PT = 1.5;
var CELL_TIGHT_PT = 0.5;
var CELL_SCALE = 3;
function aborted() {
  const error = new Error("ocr aborted");
  error.name = "AbortError";
  return error;
}
function throwIfAborted(signal) {
  if (signal?.aborted) throw aborted();
}
function pageRecord(n, items, rules, w, h, dpi, deskew) {
  return {
    n,
    w: round22(w),
    h: round22(h),
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    scan: true,
    dpi,
    deskew: round22(deskew),
    fonts: { ocr: { name: "ocr" } },
    items,
    rules,
    ops: { fnArray: [], argsArray: [] },
    engine: "ppocr-web"
  };
}
async function detect(rgb, width, height, runDet, signal, { detLimit = DET_LIMIT, unclipRatio = 1.5, boxThresh = 0.6 } = {}) {
  throwIfAborted(signal);
  const resized = detResize(rgb, width, height, detLimit);
  const data = nchwNormalize(resized.rgb, resized.w, resized.h);
  const prob = await runDet(data, [1, 3, resized.h, resized.w]);
  throwIfAborted(signal);
  const mapW = resized.w;
  const mapH = prob.length / mapW;
  if (!Number.isInteger(mapH)) throw new Error(`det map length ${prob.length} is not ${mapW} wide`);
  return boxesFromProb(prob, mapW, mapH, width, height, { unclipRatio, boxThresh });
}
function prepareCrop(rgb, width, height, box) {
  const pad = 2;
  let crop = cropRgb(rgb, width, height, box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y1 + pad);
  if (crop.w < 2 || crop.h < 2) return null;
  if (crop.h > crop.w * 1.4) crop = rotateRgb(crop.rgb, crop.w, crop.h, 90);
  const resized = recResize(crop.rgb, crop.w, crop.h, REC_H);
  return { box, resized };
}
function blitLeft(dest, batch, destW, src, srcW, height) {
  const plane = height * destW;
  const srcPlane = height * srcW;
  const base = batch * 3 * plane;
  for (let c = 0; c < 3; c++) {
    const d0 = base + c * plane;
    const s0 = c * srcPlane;
    for (let y = 0; y < height; y++) {
      dest.set(src.subarray(s0 + y * srcW, s0 + (y + 1) * srcW), d0 + y * destW);
    }
  }
}
async function readCrops(crops, scaleX, scaleY, runRec, dict2, signal) {
  const items = [];
  for (let i = 0; i < crops.length; i += BATCH) {
    throwIfAborted(signal);
    const chunk = crops.slice(i, i + BATCH);
    const maxW = Math.max(...chunk.map((c) => c.resized.w));
    const height = REC_H;
    const data = new Float32Array(chunk.length * 3 * height * maxW);
    data.fill(1);
    const normals = chunk.map((c) => nchwNormalize(c.resized.rgb, c.resized.w, c.resized.h));
    chunk.forEach((c, b) => blitLeft(data, b, maxW, normals[b], c.resized.w, height));
    const out = await runRec(data, [chunk.length, 3, height, maxW]);
    const time = out.time;
    const classes = out.classes;
    const logits = out.logits;
    chunk.forEach((c, b) => {
      const contentT = Math.max(1, Math.min(time, Math.round(time * (c.resized.contentW || c.resized.w) / maxW)));
      const start = b * time * classes;
      const slice = logits.subarray(start, start + contentT * classes);
      const pageBox = {
        x0: c.box.x0 / scaleX,
        y0: c.box.y0 / scaleY,
        x1: c.box.x1 / scaleX,
        y1: c.box.y1 / scaleY
      };
      items.push(...wordsFromCtc({ logits: slice, time: contentT, classes, dict: dict2, box: pageBox }));
    });
  }
  return items;
}
async function preparePageImage({
  rgb,
  width,
  height,
  dpi = 300,
  pointW = null,
  pointH = null,
  page = 1,
  runDet,
  runRec,
  dict: dict2,
  signal,
  detLimit = DET_LIMIT,
  unclipRatio = 1.5,
  boxThresh = 0.6
} = {}) {
  throwIfAborted(signal);
  const detOpts = { detLimit, unclipRatio, boxThresh };
  let image = rgb;
  let w = width;
  let h = height;
  let boxes = await detect(image, w, h, runDet, signal, detOpts);
  let deskew = 0;
  const tilt = dominantAngle(boxes);
  if (Math.abs(tilt) >= 0.15 && Math.abs(tilt) <= 8) {
    let bestResidual = Math.abs(tilt);
    for (const applied of [-tilt, tilt]) {
      const rotated = rotateRgb(image, w, h, applied);
      const again = await detect(rotated.rgb, rotated.w, rotated.h, runDet, signal, detOpts);
      const residual = Math.abs(dominantAngle(again));
      if (residual + 0.02 < bestResidual) {
        bestResidual = residual;
        image = rotated.rgb;
        w = rotated.w;
        h = rotated.h;
        boxes = again;
        deskew = applied;
      }
    }
  }
  const scaleX = w / (pointW || w * 72 / dpi);
  const scaleY = h / (pointH || h * 72 / dpi);
  const ptW = pointW || w / (dpi / 72);
  const ptH = pointH || h / (dpi / 72);
  const gray = grayFromRgb(image, w, h);
  const rules = rulesFromCanvas(gray, w, h, scaleX);
  const ordered = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const crops = [];
  for (const box of ordered) {
    const crop = prepareCrop(image, w, h, box);
    if (crop) crops.push(crop);
  }
  const items = snapOcrItems(await readCrops(crops, scaleX, scaleY, runRec, dict2, signal));
  const frame = { rgb: image, width: w, height: h, dpi };
  await polishDirty(items, frame, page, runRec, dict2, signal);
  return { record: pageRecord(page, items, rules, ptW, ptH, dpi, deskew), rgb: image, width: w, height: h, dpi };
}
async function polishDirty(items, frame, page, runRec, dict2, signal) {
  const dirty = items.filter((item) => {
    const text = item.str.trim();
    return !CLEAN_NUM.test(text) && !LONG_WORD.test(text);
  });
  if (!dirty.length) return;
  const read = await recognizeCells({
    pages: /* @__PURE__ */ new Map([[page, frame]]),
    cells: dirty.map((item) => ({
      page,
      bbox: [item.transform[4], item.y0, item.transform[4] + item.width, item.y1]
    })),
    runRec,
    dict: dict2,
    signal
  });
  dirty.forEach((item, i) => {
    const text = (read.cells[i]?.text || "").trim();
    if (!CLEAN_NUM.test(text)) return;
    item.str = text;
    item.conf = bucketConf(read.cells[i].conf || 0);
  });
}
async function readCell(prep, cell, runRec, dict2, signal) {
  throwIfAborted(signal);
  const scale = prep.dpi / 72;
  const [x0, y0, x1, y1] = cell.bbox;
  const crop = cropRgb(prep.rgb, prep.width, prep.height, (x0 - CELL_PAD_PT) * scale, (y0 - CELL_PAD_PT) * scale, (x1 + CELL_PAD_PT) * scale, (y1 + CELL_PAD_PT) * scale);
  const tight = cropRgb(prep.rgb, prep.width, prep.height, (x0 - CELL_TIGHT_PT) * scale, (y0 - CELL_TIGHT_PT) * scale, (x1 + CELL_TIGHT_PT) * scale, (y1 + CELL_TIGHT_PT) * scale);
  const glyph = tight.w >= 2 && tight.h >= 2 ? inkGlyph(grayFromRgb(tight.rgb, tight.w, tight.h), tight.w, tight.h) : null;
  if (crop.w < 2 || crop.h < 2) return { page: cell.page, bbox: cell.bbox, text: "", conf: 0, glyph };
  const scaled = resizeRgb(crop.rgb, crop.w, crop.h, crop.w * CELL_SCALE, crop.h * CELL_SCALE);
  const padded = padWhite(scaled.rgb, scaled.w, scaled.h, 8);
  const resized = recResize(padded.rgb, padded.w, padded.h, REC_H);
  const data = nchwNormalize(resized.rgb, resized.w, resized.h);
  const out = await runRec(data, [1, 3, resized.h, resized.w]);
  const contentT = Math.max(1, Math.min(out.time, Math.round(out.time * (resized.contentW || resized.w) / resized.w)));
  const slice = out.logits.subarray(0, contentT * out.classes);
  const text = ctcText({ logits: slice, time: contentT, classes: out.classes, dict: dict2 });
  return { page: cell.page, bbox: cell.bbox, text: text.text, conf: text.conf, glyph };
}
async function recognizeCells({ pages: pages2, cells, runRec, dict: dict2, signal } = {}) {
  const out = [];
  for (const cell of cells || []) {
    const prep = pages2?.get?.(cell.page);
    if (!prep) {
      out.push({ page: cell.page, bbox: cell.bbox, text: "", conf: 0, glyph: null });
      continue;
    }
    const read = await readCell(prep, cell, runRec, dict2, signal);
    out.push(read);
  }
  return { cells: out };
}

// src/host/ocr-ort.js
async function openSession(ort, buffer) {
  try {
    return await ort.InferenceSession.create(buffer, { executionProviders: ["webgpu", "wasm"] });
  } catch {
    return await ort.InferenceSession.create(buffer, { executionProviders: ["wasm"] });
  }
}
async function createOrtRunners(ort, detBuffer, recBuffer) {
  const det = await openSession(ort, detBuffer);
  const rec = await openSession(ort, recBuffer);
  return {
    async runDet(data, dims) {
      const out = await det.run({ x: new ort.Tensor("float32", data, dims) });
      return out.fetch_name_0.data;
    },
    async runRec(data, dims) {
      const out = await rec.run({ x: new ort.Tensor("float32", data, dims) });
      const tensor = out.fetch_name_0;
      return { logits: tensor.data, batch: tensor.dims[0], time: tensor.dims[1], classes: tensor.dims[2] };
    }
  };
}

// src/host/ocr-web-worker.js
var pages = /* @__PURE__ */ new Map();
var runners = null;
var dict = null;
var controller = new AbortController();
function fail(id, error) {
  self.postMessage({ type: "error", id, message: error?.message || String(error) });
}
async function onInit(msg) {
  const ort = await import(msg.ortUrl);
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = { mjs: msg.wasmMjsUrl, wasm: msg.wasmUrl };
    if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) ort.env.wasm.numThreads = 1;
  }
  runners = await createOrtRunners(ort, msg.det, msg.rec);
  dict = dictLines(msg.dictText);
  self.postMessage({ type: "ready", id: msg.id });
}
async function onPage(msg) {
  const rgb = new Uint8Array(msg.rgb);
  const prep = await preparePageImage({
    rgb,
    width: msg.width,
    height: msg.height,
    dpi: msg.dpi,
    pointW: msg.pointW,
    pointH: msg.pointH,
    page: msg.n,
    runDet: runners.runDet,
    runRec: runners.runRec,
    dict,
    signal: controller.signal
  });
  pages.set(msg.n, prep);
  self.postMessage({ type: "page", id: msg.id, record: prep.record });
}
async function onCells(msg) {
  const result = await recognizeCells({
    pages,
    cells: msg.cells,
    runRec: runners.runRec,
    dict,
    signal: controller.signal
  });
  self.postMessage({ type: "cells", id: msg.id, cells: result.cells });
}
self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === "abort") {
    controller.abort();
    return;
  }
  if (msg.type === "init") controller = new AbortController();
  const run = msg.type === "init" ? onInit(msg) : msg.type === "page" ? onPage(msg) : msg.type === "cells" ? onCells(msg) : null;
  if (run) run.catch((error) => fail(msg.id, error));
};
