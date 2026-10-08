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
function padWhite(rgb, w, h, pad, padY = pad) {
  if (!pad && !padY) return { rgb, w, h };
  const dw = w + pad * 2;
  const dh = h + padY * 2;
  const out = new Uint8Array(dw * dh * 3);
  out.fill(255);
  for (let y = 0; y < h; y++) {
    const src = y * w * 3;
    out.set(rgb.subarray(src, src + w * 3), ((y + padY) * dw + pad) * 3);
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
function rulesFromCanvas(gray, width, height, scale, { minLenPt = 18, fills = [] } = {}) {
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
  return fills.length ? out.filter((r) => !fills.some((f) => insideFill(r, f))) : out;
}
function insideFill(r, f, m = 1) {
  if (r.y0 === r.y1) return r.y0 > f.y0 + m && r.y0 < f.y1 - m && r.x0 >= f.x0 - m && r.x1 <= f.x1 + m;
  return r.x0 > f.x0 + m && r.x0 < f.x1 - m && r.y0 >= f.y0 - m && r.y1 <= f.y1 + m;
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
function fillsFromCanvas(gray, width, height, scale, { tol = 14, minWPt = 8, minHPt = 4, edge = 0.8, solid = 0.55, openPt = 2 } = {}) {
  if (!gray || width < 8 || height < 8 || !(scale > 0)) return [];
  const step = Math.max(1, Math.floor(scale / 2));
  const sw = Math.floor(width / step);
  const sh = Math.floor(height / step);
  if (sw < 4 || sh < 4) return [];
  const g = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) g[y * sw + x] = gray[y * step * width + x * step];
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const ink = otsuThreshold(g);
  let paper = 255;
  let best = -1;
  for (let v = ink + 1; v < 256; v++) if (hist[v] > best) {
    best = hist[v];
    paper = v;
  }
  const seedMax = paper - 2 * tol;
  if (seedMax <= 0) return [];
  const per = scale / step;
  const minW = minWPt * per;
  const minH = minHPt * per;
  const k = Math.max(3, Math.round(openPt * per));
  const label = new Int32Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  const pageArea = sw * sh;
  const out = [];
  let next = 0;
  for (let sy = 1; sy < sh - 1; sy++) {
    for (let sx = 1; sx < sw - 1; sx++) {
      const s = sy * sw + sx;
      if (label[s] || g[s] > seedMax) continue;
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = g[s + dy * sw + dx];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > 6) continue;
      const id = ++next;
      const seed = g[s];
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = id;
      let x0 = sx;
      let x1 = sx;
      let y0 = sy;
      let y1 = sy;
      while (head < tail) {
        const i = queue[head++];
        const x = i % sw;
        const y = (i - x) / sw;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x > 0) {
          const j = i - 1;
          if (!label[j] && Math.abs(g[j] - seed) <= tol) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
        if (x + 1 < sw) {
          const j = i + 1;
          if (!label[j] && Math.abs(g[j] - seed) <= tol) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
        if (y > 0) {
          const j = i - sw;
          if (!label[j] && Math.abs(g[j] - seed) <= tol) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
        if (y + 1 < sh) {
          const j = i + sw;
          if (!label[j] && Math.abs(g[j] - seed) <= tol) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
      }
      if (x1 - x0 + 1 < minW || y1 - y0 + 1 < minH || tail < 0.5 * minW * minH) continue;
      const lw = x1 - x0 + 1 + 2 * k;
      const lh = y1 - y0 + 1 + 2 * k;
      const local = new Uint8Array(lw * lh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (label[y * sw + x] === id) local[(y - y0 + k) * lw + (x - x0 + k)] = 1;
      let opened = morph1d(local, lw, lh, k, true, false);
      opened = morph1d(opened, lw, lh, k, false, false);
      opened = morph1d(opened, lw, lh, k, true, true);
      opened = morph1d(opened, lw, lh, k, false, true);
      for (const part of flatParts(opened, lw, lh)) {
        const bw = part.x1 - part.x0 + 1;
        const bh = part.y1 - part.y0 + 1;
        if (bw < minW || bh < minH) continue;
        if (bw * bh >= 0.8 * pageArea || part.area < solid * bw * bh) continue;
        const share = (ax, ay, bx, by) => {
          let hit = 0;
          let n2 = 0;
          for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
            n2++;
            if (part.mask[y * lw + x]) hit++;
          }
          return n2 ? hit / n2 : 0;
        };
        const iy0 = Math.min(part.y1, part.y0 + 1);
        const iy1 = Math.max(part.y0, part.y1 - 1);
        const ix0 = Math.min(part.x1, part.x0 + 1);
        const ix1 = Math.max(part.x0, part.x1 - 1);
        if (share(part.x0, iy0, part.x1, iy0) < edge || share(part.x0, iy1, part.x1, iy1) < edge) continue;
        if (share(ix0, part.y0, ix0, part.y1) < edge || share(ix1, part.y0, ix1, part.y1) < edge) continue;
        const corner = (x, y) => part.mask[y * lw + x];
        if (!corner(part.x0, part.y0) || !corner(part.x1, part.y0) || !corner(part.x0, part.y1) || !corner(part.x1, part.y1)) continue;
        let sum = 0;
        let n = 0;
        for (let y = part.y0; y <= part.y1; y++) for (let x = part.x0; x <= part.x1; x++) {
          if (!part.mask[y * lw + x]) continue;
          sum += g[(y + y0 - k) * sw + (x + x0 - k)];
          n++;
        }
        const gx0 = part.x0 + x0 - k;
        const gy0 = part.y0 + y0 - k;
        out.push({
          x0: round2(gx0 * step / scale),
          y0: round2(gy0 * step / scale),
          x1: round2((gx0 + bw) * step / scale),
          y1: round2((gy0 + bh) * step / scale),
          gray: Math.round(sum / n / 255 * 1e3) / 1e3
        });
      }
    }
  }
  out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return out;
}
function flatParts(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const parts = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const own = new Uint8Array(w * h);
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    while (head < tail) {
      const i = queue[head++];
      own[i] = 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]) {
        if (j < 0 || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    parts.push({ x0, y0, x1, y1, area: tail, mask: own });
  }
  return parts;
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
function baselineRows(sorted) {
  const rows = [];
  let row = null;
  for (const item of sorted) {
    const base = item.transform[5];
    const size = item.transform[0] || 1;
    if (row && base - row.last <= 0.3 * size && base - row.first <= 0.45 * size) {
      row.items.push(item);
      row.last = base;
      continue;
    }
    row = { first: base, last: base, items: [item] };
    rows.push(row);
  }
  return rows.map((r) => r.items);
}
function rowBaseline(row) {
  const pairs = row.map((item) => [item.transform[5], Math.max(0.1, item.width || 0)]).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [base, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return base;
  }
  return pairs[pairs.length - 1][0];
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
  for (const row of baselineRows(kept)) {
    const anchor = rowBaseline(row);
    for (const item of row) {
      const shift = anchor - item.transform[5];
      item.transform[5] = round22(anchor);
      item.y0 = round22(item.y0 + shift);
      item.y1 = round22(item.y1 + shift);
    }
  }
  kept.sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  return kept;
}

// src/model/ocr/word-split.js
function inkProjection(mask, pageW, pageH, box) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(pageW, Math.ceil(box.x1));
  const y1 = Math.min(pageH, Math.ceil(box.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const ruleRow = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * pageW + x0;
    let longest = 0;
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        run++;
        if (run > longest) longest = run;
      } else run = 0;
    }
    const through = mask[row] && mask[row + w - 1] && longest >= 0.9 * w;
    if (longest >= 0.6 * w && longest >= 3 * h || through) ruleRow[y] = 1;
  }
  const cols = new Uint16Array(w);
  const rowInk = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    if (ruleRow[y]) continue;
    const row = (y0 + y) * pageW + x0;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        cols[x]++;
        rowInk[y]++;
      }
    }
  }
  const live = h - ruleRow.reduce((s, v) => s + v, 0);
  for (let x = 0; x < w; x++) {
    if (cols[x] >= 0.92 * live && live >= 6) {
      const left = x > 0 ? cols[x - 1] : 0;
      const right = x < w - 1 ? cols[x + 1] : 0;
      if (left < 0.6 * live || right < 0.6 * live) cols[x] = 0;
    }
  }
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    if (rowInk[y]) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return { x0, y0, w, h, cols, rowInk, ruleRow, top, bottom };
}
function inkRuns(cols, minGap, minInk = 2) {
  const runs = [];
  let start = -1;
  let last = -1;
  let ink = 0;
  for (let x = 0; x < cols.length; x++) {
    if (!cols[x]) continue;
    if (start >= 0 && x - last - 1 >= minGap) {
      if (ink >= minInk) runs.push({ x0: start, x1: last + 1, ink });
      start = -1;
      ink = 0;
    }
    if (start < 0) start = x;
    last = x;
    ink += cols[x];
  }
  if (start >= 0 && ink >= minInk) runs.push({ x0: start, x1: last + 1, ink });
  return runs;
}
function innerGaps(cols, from, to) {
  const gaps = [];
  let start = -1;
  for (let x = from; x < to; x++) {
    if (!cols[x]) {
      if (start < 0) start = x;
      continue;
    }
    if (start > from) gaps.push({ x0: start, x1: x, w: x - start });
    start = -1;
  }
  return gaps;
}
function inkRows(mask, pageW, proj, c0, c1) {
  const rows = new Uint32Array(proj.h);
  const span = c1 - c0;
  let solid = 0;
  let glyphRows = 0;
  for (let y = 0; y < proj.h; y++) {
    if (proj.ruleRow[y]) continue;
    const row = (proj.y0 + y) * pageW + proj.x0;
    let n = 0;
    for (let x = c0; x < c1; x++) n += mask[row + x];
    rows[y] = n;
    if (span >= 4 && n >= 0.85 * span) solid++;
    else if (n) glyphRows++;
  }
  if (solid && glyphRows) {
    for (let y = 0; y < proj.h; y++) if (rows[y] >= 0.85 * span) rows[y] = 0;
  }
  let max = 0;
  let peak = -1;
  let bestScore = 0;
  const mid = (proj.h - 1) / 2;
  for (let y = 0; y < proj.h; y++) {
    const score = rows[y] * (1 - 0.6 * Math.abs(y - mid) / Math.max(1, mid));
    if (score > bestScore) {
      bestScore = score;
      peak = y;
    }
  }
  if (peak < 0) return null;
  max = rows[peak];
  const edge = (step) => {
    let y = peak;
    let valley = peak;
    let thin = false;
    while (y + step >= 0 && y + step < proj.h && rows[y + step]) {
      y += step;
      if (!thin && rows[y] < 0.1 * max) {
        thin = true;
        valley = y;
      }
      if (thin && rows[y] < rows[valley]) valley = y;
      if (thin && rows[y] >= 0.25 * max) return valley - step;
    }
    return y;
  };
  const top = edge(-1);
  const bottom = edge(1);
  for (let y = top; y <= bottom; y++) if (rows[y] > max) {
    max = rows[y];
  }
  let base = peak;
  for (let y = bottom; y >= peak; y--) {
    if (rows[y] >= 0.25 * max) {
      base = y;
      break;
    }
  }
  let capTop = peak;
  for (let y = top; y <= peak; y++) {
    if (rows[y] >= 0.25 * max) {
      capTop = y;
      break;
    }
  }
  return { base: proj.y0 + base + 1, top: proj.y0 + top, bottom: proj.y0 + bottom + 1, capTop: proj.y0 + capTop };
}
function inkHeight(proj) {
  if (proj.top < 0) return 0;
  return proj.bottom - proj.top + 1;
}
function segmentLine(mask, pageW, pageH, box, { gapRatio = 0.35, minGapPx = 2 } = {}) {
  const proj = inkProjection(mask, pageW, pageH, box);
  if (!proj) return null;
  const inkH = inkHeight(proj);
  if (inkH < 3) return null;
  const minGap = Math.max(minGapPx, Math.round(gapRatio * inkH));
  const minInk = Math.max(2, Math.round(0.02 * inkH * inkH));
  const runs = inkRuns(proj.cols, minGap, minInk);
  if (!runs.length) return null;
  const segments = runs.map((run) => ({
    x0: proj.x0 + run.x0,
    x1: proj.x0 + run.x1,
    y0: proj.y0,
    y1: proj.y0 + proj.h,
    cols: [run.x0, run.x1],
    ink: inkRows(mask, pageW, proj, run.x0, run.x1)
  }));
  return { proj, inkH, minGap, segments };
}
function snapWords(groups, seg, proj) {
  const [c0, c1] = seg.cols;
  if (groups.length <= 1) {
    return groups.map((g) => ({ text: g.text, x0: proj.x0 + c0, x1: proj.x0 + c1 }));
  }
  const span = c1 - c0;
  const gaps = innerGaps(proj.cols, c0, c1);
  const cuts = [];
  const used = /* @__PURE__ */ new Set();
  for (let i = 1; i < groups.length; i++) {
    const want = (groups[i - 1].c1 + groups[i].c0) / 2;
    let best = -1;
    let bestD = Infinity;
    gaps.forEach((gap, k) => {
      if (used.has(k)) return;
      const mid = (gap.x0 + gap.x1) / 2;
      const d = Math.abs(mid - want) - 0.25 * gap.w;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best >= 0 && bestD <= Math.max(6, 0.12 * span)) {
      used.add(best);
      cuts.push({ x0: gaps[best].x0, x1: gaps[best].x1 });
    } else {
      const x = Math.round(want);
      cuts.push({ x0: x, x1: x });
    }
  }
  cuts.sort((a, b) => a.x0 - b.x0);
  const words = [];
  let from = c0;
  groups.forEach((g, i) => {
    const to = i < cuts.length ? cuts[i].x0 : c1;
    words.push({ text: g.text, x0: proj.x0 + from, x1: proj.x0 + Math.max(from + 1, to) });
    if (i < cuts.length) from = cuts[i].x1;
  });
  return words;
}
function sizeFromInk(text, capH) {
  if (!(capH > 0)) return null;
  if (/[A-Z0-9bdfhklt]/.test(text)) return capH / 0.64;
  return null;
}
function dashRuns(mask, pageW, proj, c0, c1, base, capH) {
  if (!(capH > 4)) return [];
  const lo = base - 0.65 * capH;
  const hi = base - 0.15 * capH;
  const kind = new Uint8Array(c1 - c0);
  for (let x = c0; x < c1; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < proj.h; y++) {
      if (proj.ruleRow[y]) continue;
      if (mask[(proj.y0 + y) * pageW + proj.x0 + x]) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) {
      kind[x - c0] = 0;
      continue;
    }
    const yTop = proj.y0 + top;
    const yBot = proj.y0 + bottom + 1;
    kind[x - c0] = yTop >= lo && yBot <= hi && yBot - yTop <= 0.25 * capH ? 2 : 1;
  }
  const runs = [];
  let start = -1;
  for (let i = 0; i <= kind.length; i++) {
    if (i < kind.length && kind[i] === 2) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    const end = i;
    const apart = start > 0 && kind[start - 1] === 0 && end < kind.length && kind[end] === 0;
    const left = kind.slice(Math.max(0, start - Math.ceil(0.4 * capH)), start).some((k) => k === 1);
    const right = kind.slice(end, end + Math.ceil(0.4 * capH)).some((k) => k === 1);
    if (apart && end - start >= 0.3 * capH && left && right) runs.push({ c0: c0 + start, c1: c0 + end });
    start = -1;
  }
  return runs;
}
function joinNumberWords(words, maxGap) {
  const out = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && /\d[,.]$/.test(prev.text) && /^\d{3}(?:[,.]\d+)*,?$/.test(word.text) && /^[$€£(]?[\d,.]+$/.test(prev.text) && word.x0 - prev.x1 <= maxGap) {
      prev.text += word.text;
      prev.x1 = word.x1;
      prev.conf = Math.min(prev.conf, word.conf);
      continue;
    }
    out.push({ ...word });
  }
  return out;
}
function localMask(gray, mask, pageW, pageH, box, minContrast = 60) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(pageW, Math.ceil(box.x1));
  const y1 = Math.min(pageH, Math.ceil(box.y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return false;
  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * pageW + x]]++;
  const total = (x1 - x0) * (y1 - y0);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thresh = 0;
  let meanDark = 0;
  let meanLight = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thresh = t;
      meanDark = mB;
      meanLight = mF;
    }
  }
  if (meanLight - meanDark < minContrast) return false;
  let dark = 0;
  for (let t = 0; t <= thresh; t++) dark += hist[t];
  const inverted = dark > 0.6 * total;
  for (let y = y0; y < y1; y++) {
    const row = y * pageW;
    for (let x = x0; x < x1; x++) mask[row + x] = gray[row + x] <= thresh !== inverted ? 1 : 0;
  }
  return true;
}

// src/model/ocr/orphans.js
function coverMask(boxes, pageW, pageH, pad = 0) {
  const mask = new Uint8Array(pageW * pageH);
  for (const b of boxes || []) {
    const x0 = Math.max(0, Math.floor(b.x0 - pad));
    const y0 = Math.max(0, Math.floor(b.y0 - pad));
    const x1 = Math.min(pageW, Math.ceil(b.x1 + pad));
    const y1 = Math.min(pageH, Math.ceil(b.y1 + pad));
    for (let y = y0; y < y1; y++) mask.fill(1, y * pageW + x0, y * pageW + x1);
  }
  return mask;
}
function orphanBlobs(components, covered, pageW, em) {
  if (!(em > 0)) return [];
  const minArea = Math.max(4, 0.01 * em * em);
  const parts = [];
  for (const c of components || []) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (c.area < minArea) continue;
    if (h > 1.3 * em || w > 4 * em) continue;
    if (w >= 2.5 * em && h <= 0.2 * em) continue;
    const cx = Math.round((c.x0 + c.x1) / 2);
    const cy = Math.round((c.y0 + c.y1) / 2);
    if (covered[cy * pageW + cx]) continue;
    parts.push({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1 });
  }
  parts.sort((a, b) => a.x0 - b.x0);
  const blobs = [];
  for (const p of parts) {
    const pcy = (p.y0 + p.y1) / 2;
    const host = blobs.find((b) => p.x0 - b.x1 <= 0.5 * em && p.x0 >= b.x0 - 0.5 * em && Math.abs(pcy - (b.y0 + b.y1) / 2) <= 0.6 * em && Math.max(b.y1, p.y1) - Math.min(b.y0, p.y0) <= 1.3 * em);
    if (host) {
      host.x0 = Math.min(host.x0, p.x0);
      host.y0 = Math.min(host.y0, p.y0);
      host.x1 = Math.max(host.x1, p.x1);
      host.y1 = Math.max(host.y1, p.y1);
      host.parts++;
    } else blobs.push({ ...p, parts: 1 });
  }
  return blobs.filter((b) => b.x1 - b.x0 <= 8 * em);
}
function blobBaseline(blob, em) {
  const h = blob.y1 - blob.y0;
  if (h >= 0.45 * em) return blob.y1;
  return (blob.y0 + blob.y1) / 2 + 0.25 * em;
}
var HALLUCINATION = /yanma|ianm|gent|cmyk/i;
function acceptOrphanRead(text, conf, blob, em) {
  const t = String(text || "").trim();
  if (!t) return false;
  const w = blob.x1 - blob.x0;
  const h = blob.y1 - blob.y0;
  if (/^[-–—]$/.test(t)) return w >= 1.8 * h && h <= 0.2 * em;
  if (conf < 0.6) return false;
  if (HALLUCINATION.test(t)) return false;
  if (!/[\p{L}\p{N}]/u.test(t)) return false;
  const maxChars = Math.ceil((blob.x1 - blob.x0) / (0.25 * em)) + 2;
  return t.replace(/\s+/g, "").length <= maxChars;
}
function dashFromShape(blob, em) {
  const w = blob.x1 - blob.x0;
  const h = blob.y1 - blob.y0;
  if (blob.parts !== 1 || h > 0.2 * em || w < 3 * h || w < 0.2 * em || w > 1.6 * em) return null;
  if (w < 0.45 * em) return "-";
  if (w < 0.8 * em) return "\u2013";
  return "\u2014";
}

// src/model/ocr/fine-skew.js
function rowsOf(items) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  const rows = [];
  for (const it of sorted) {
    const size = it.transform[0];
    const base = it.transform[5];
    let best = null;
    for (const row of rows) {
      const last = row[row.length - 1];
      if (it.transform[4] < last.transform[4] + last.width - 0.5) continue;
      const d = Math.abs(last.transform[5] - base);
      if (d <= 0.3 * Math.max(size, last.transform[0]) && (!best || d < best.d)) best = { row, d };
    }
    if (best) best.row.push(it);
    else rows.push([it]);
  }
  return rows;
}
function baselineSkew(items, { minSpan = 150, minWords = 3, minRows = 3 } = {}) {
  const votes = [];
  for (const row of rowsOf(items.filter((it) => it.str && it.str.trim()))) {
    if (row.length < minWords) continue;
    const xs = row.map((it) => it.transform[4] + it.width / 2);
    const span = Math.max(...row.map((it) => it.transform[4] + it.width)) - Math.min(...row.map((it) => it.transform[4]));
    if (span < minSpan) continue;
    const ys = row.map((it) => it.transform[5]);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    if (!sxx) continue;
    votes.push({ a: Math.atan(sxy / sxx) * 180 / Math.PI, w: span });
  }
  if (votes.length < minRows) return null;
  votes.sort((p, q) => p.a - q.a);
  const total = votes.reduce((s, v) => s + v.w, 0);
  let acc = 0;
  for (const v of votes) {
    acc += v.w;
    if (acc >= total / 2) return v.a;
  }
  return votes[votes.length - 1].a;
}
function rotateItems(items, degrees, w, h, scaleX, scaleY) {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const it of items) {
    const dx = it.transform[4] * scaleX - cx;
    const dy = it.transform[5] * scaleY - cy;
    const x = (cx + dx * cos + dy * sin) / scaleX;
    const base = (cy - dx * sin + dy * cos) / scaleY;
    const shift = base - it.transform[5];
    it.transform[4] = r2(x);
    it.transform[5] = r2(base);
    if (Number.isFinite(it.y0)) it.y0 = r2(it.y0 + shift);
    if (Number.isFinite(it.y1)) it.y1 = r2(it.y1 + shift);
  }
  return items;
}

// src/model/ocr/recognize.js
var DET_LIMIT = "auto";
var DET_PROBE = 1600;
var DET_TARGET_H = 27;
var DET_MIN = 960;
var DET_MAX = 4096;
var REC_H = 48;
var BATCH = 8;
var SEG_BATCH = 16;
var SPACE_CH = /* @__PURE__ */ new Set([" ", "\u3000", "\xA0"]);
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
function pageRecord(n, items, rules, w, h, dpi, deskew, fills = []) {
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
    fills,
    ops: { fnArray: [], argsArray: [] },
    engine: "ppocr-web"
  };
}
function detLimitFor(probeH, probeLimit, longSide, target = DET_TARGET_H) {
  const probeScale = Math.min(1, probeLimit / longSide);
  if (!(probeH > 0)) return Math.min(longSide, probeLimit);
  const scale = Math.min(1, probeScale * target / probeH);
  return Math.round(Math.max(DET_MIN, Math.min(DET_MAX, longSide * scale)));
}
function medianMapHeight(boxes, mapScale) {
  const hs = boxes.map((b) => (b.y1 - b.y0) * mapScale).sort((a, b) => a - b);
  return hs.length ? hs[hs.length >> 1] : 0;
}
async function detect(rgb, width, height, runDet, signal, opts = {}) {
  const { detLimit = DET_LIMIT } = opts;
  if (detLimit !== "auto") return detectAt(rgb, width, height, runDet, signal, opts);
  const long = Math.max(width, height);
  const probe = await detectAt(rgb, width, height, runDet, signal, { ...opts, detLimit: DET_PROBE });
  const probeScale = Math.min(1, DET_PROBE / long);
  const limit = detLimitFor(medianMapHeight(probe, probeScale), DET_PROBE, long);
  opts.chosenLimit = limit;
  if (Math.abs(Math.min(limit, long) - Math.min(DET_PROBE, long)) <= 0.12 * Math.min(DET_PROBE, long)) return probe;
  return detectAt(rgb, width, height, runDet, signal, { ...opts, detLimit: limit });
}
async function detectAt(rgb, width, height, runDet, signal, { detLimit = DET_PROBE, unclipRatio = 1.5, boxThresh = 0.6 } = {}) {
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
function widthBatches(widths, batchSize = SEG_BATCH, ratio = 1.3) {
  const order = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
  const batches = [];
  let cur = [];
  for (const k of order) {
    if (cur.length && (cur.length >= batchSize || widths[k] > ratio * widths[cur[0]] + 16)) {
      batches.push(cur);
      cur = [];
    }
    cur.push(k);
  }
  if (cur.length) batches.push(cur);
  return batches;
}
async function recBatches(crops, runRec, signal, batchSize = SEG_BATCH) {
  const out = new Array(crops.length);
  for (const idx of widthBatches(crops.map((c) => c.resized.w), batchSize)) {
    throwIfAborted(signal);
    const maxW = Math.max(...idx.map((k) => crops[k].resized.w));
    const data = new Float32Array(idx.length * 3 * REC_H * maxW);
    idx.forEach((k, b) => {
      const c = crops[k].resized;
      blitLeft(data, b, maxW, nchwNormalize(c.rgb, c.w, c.h), c.w, REC_H);
    });
    const res = await runRec(data, [idx.length, 3, REC_H, maxW]);
    idx.forEach((k, b) => {
      const c = crops[k].resized;
      const contentT = Math.max(1, Math.min(res.time, Math.round(res.time * (c.contentW || c.w) / maxW)));
      const start = b * res.time * res.classes;
      out[k] = { logits: res.logits.slice(start, start + contentT * res.classes), time: contentT, classes: res.classes };
    });
  }
  return out;
}
function pageMask(gray) {
  const thresh = otsuThreshold(gray);
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) if (gray[i] <= thresh) mask[i] = 1;
  return mask;
}
var DASHES = /* @__PURE__ */ new Set(["-", "\u2013", "\u2014", "\u2212"]);
function restoreDashes(chars, crop, time, mask, pageW) {
  const ink = crop.seg.ink;
  const capH = ink.base - ink.top;
  const [c0, c1] = crop.seg.cols;
  const runs = dashRuns(mask, pageW, crop.proj, c0, c1, ink.base, capH);
  if (!runs.length) return;
  const toT = (col) => (col + crop.proj.x0 - crop.cropLeft) / crop.cropW * time;
  for (const run of runs) {
    const t0 = toT(run.c0) - 1;
    const t1 = toT(run.c1) + 1;
    if (chars.some((ch2) => DASHES.has(ch2.ch) && ch2.t >= t0 && ch2.t <= t1)) continue;
    const t = Math.round((toT(run.c0) + toT(run.c1)) / 2);
    const at = chars.findIndex((ch2) => ch2.t > t);
    const ch = { ch: run.c1 - run.c0 >= 1.2 * capH ? "\u2014" : "\u2013", t, conf: 0.9 };
    if (at < 0) chars.push(ch);
    else chars.splice(at, 0, ch);
  }
}
async function readSegments(image, w, h, boxes, mask, scaleX, scaleY, runRec, dict2, signal, opts) {
  const crops = [];
  const lineBoxes = [];
  for (const box of boxes) {
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const split = bh <= bw * 1.4 ? segmentLine(mask, w, h, box, opts) : null;
    if (!split) {
      lineBoxes.push(box);
      continue;
    }
    const { segments, proj, inkH } = split;
    const padX = Math.max(2, Math.round(opts.padRatio * inkH));
    segments.forEach((seg, i) => {
      const prev = segments[i - 1];
      const next = segments[i + 1];
      const left = Math.max(prev ? (prev.x1 + seg.x0) / 2 : -Infinity, seg.x0 - padX);
      const right = Math.min(next ? (seg.x1 + next.x0) / 2 : Infinity, seg.x1 + padX);
      const ink = seg.ink;
      const padY = ink ? Math.max(2, Math.round(opts.padYRatio * (ink.bottom - ink.top))) : 2;
      const top = ink ? Math.max(box.y0 - 2, ink.top - padY) : box.y0 - 2;
      const bottom = ink ? Math.min(box.y1 + 2, ink.bottom + padY) : box.y1 + 2;
      const crop = cropRgb(image, w, h, left, top, right, bottom);
      if (crop.w < 2 || crop.h < 2) return;
      const white = Math.round(opts.whiteRatio * crop.h);
      const padded = padWhite(crop.rgb, crop.w, crop.h, white, white);
      const cropLeft = Math.max(0, Math.floor(left)) - white;
      crops.push({ box, seg, proj, cropLeft, cropW: padded.w, resized: recResize(padded.rgb, padded.w, padded.h, REC_H) });
    });
  }
  const reads = await recBatches(crops, runRec, signal);
  const items = [];
  crops.forEach((crop, k) => {
    const read = reads[k];
    const chars = ctcDecode(read.logits, read.time, read.classes, dict2);
    if (crop.seg.ink && mask) restoreDashes(chars, crop, read.time, mask, w);
    const groups = [];
    let cur = null;
    for (const ch of chars) {
      if (SPACE_CH.has(ch.ch)) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { chars: [] };
        groups.push(cur);
      }
      cur.chars.push(ch);
    }
    if (!groups.length) return;
    const toCol = (t) => crop.cropLeft + t / read.time * crop.cropW - crop.proj.x0;
    const named = groups.map((g) => ({
      text: g.chars.map((c) => c.ch).join(""),
      c0: toCol(g.chars[0].t),
      c1: toCol(g.chars[g.chars.length - 1].t + 1),
      conf: g.chars.reduce((s, c) => s + c.conf, 0) / g.chars.length
    }));
    const snapped = snapWords(named, crop.seg, crop.proj).map((word, i) => ({ ...word, conf: named[i].conf }));
    const capH = crop.seg.ink ? crop.seg.ink.base - crop.seg.ink.top : 0;
    const words = capH ? joinNumberWords(snapped, 0.35 * capH) : snapped;
    const boxPt = { x0: crop.box.x0 / scaleX, y0: crop.box.y0 / scaleY, x1: crop.box.x1 / scaleX, y1: crop.box.y1 / scaleY };
    const ink = crop.seg.ink;
    const size = ink ? sizeFromInk(named.map((g) => g.text).join(""), (ink.base - ink.capTop) / scaleY) || boxPt.y1 - boxPt.y0 : 0;
    for (const word of words) {
      if (!word.text) continue;
      let box = boxPt;
      if (ink) {
        const own = inkRows(mask, w, crop.proj, Math.max(0, word.x0 - crop.proj.x0), Math.min(crop.proj.w, word.x1 - crop.proj.x0));
        const base = (own ? own.base : ink.base) / scaleY;
        box = { ...boxPt, y1: base + 0.2 * size, y0: base - 0.8 * size };
      }
      items.push(wordItem(word.text, word.x0 / scaleX, word.x1 / scaleX, box, word.conf));
    }
  });
  if (lineBoxes.length) {
    const lineCrops = [];
    for (const box of lineBoxes) {
      const crop = prepareCrop(image, w, h, box);
      if (crop) lineCrops.push(crop);
    }
    items.push(...await readCrops(lineCrops, scaleX, scaleY, runRec, dict2, signal));
  }
  return items;
}
function medianSize(items) {
  const sizes = items.filter((i) => /[A-Z0-9bdfhklt]/.test(i.str)).map((i) => i.transform[0]).sort((a, b) => a - b);
  return sizes.length ? sizes[sizes.length >> 1] : 0;
}
async function readOrphans(image, w, h, boxes, mask, items, scaleX, scaleY, runRec, dict2, signal) {
  const emPt = medianSize(items);
  if (!emPt) return [];
  const em = emPt * scaleY;
  const covered = coverMask(boxes, w, h, Math.round(0.1 * em));
  const blobs = orphanBlobs(labelComponents(mask, w, h), covered, w, em);
  if (!blobs.length) return [];
  const crops = [];
  const out = [];
  const place = (text, blob, conf) => {
    const base = blobBaseline(blob, em) / scaleY;
    const box = { x0: blob.x0 / scaleX, x1: blob.x1 / scaleX, y1: base + 0.2 * emPt, y0: base - 0.8 * emPt };
    out.push(wordItem(text, box.x0, box.x1, box, conf));
  };
  for (const blob of blobs) {
    const dash = dashFromShape(blob, em);
    if (dash) {
      place(dash, blob, 1);
      continue;
    }
    const crop = cropRgb(image, w, h, blob.x0 - 1, blob.y0 - 1, blob.x1 + 1, blob.y1 + 1);
    if (crop.w < 1 || crop.h < 1) continue;
    const padY = Math.max(0, Math.round((1.2 * em - crop.h) / 2));
    const padded = padWhite(crop.rgb, crop.w, crop.h, Math.round(0.35 * em), padY);
    crops.push({ blob, resized: recResize(padded.rgb, padded.w, padded.h, REC_H) });
  }
  const reads = crops.length ? await recBatches(crops, runRec, signal) : [];
  crops.forEach((crop, k) => {
    const read = ctcText({ logits: reads[k].logits, time: reads[k].time, classes: reads[k].classes, dict: dict2 });
    if (acceptOrphanRead(read.text, read.conf, crop.blob, em)) place(read.text.replace(/\s+/g, ""), crop.blob, read.conf);
  });
  return out;
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
  boxThresh = 0.5,
  split = true,
  gapRatio = 0.9,
  padRatio = 0.2,
  padYRatio = 0.1,
  whiteRatio = 0,
  orphans = true,
  localInk = true,
  fineSkew = true
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
      const again = await detect(rotated.rgb, rotated.w, rotated.h, runDet, signal, detOpts.chosenLimit ? { ...detOpts, detLimit: detOpts.chosenLimit } : detOpts);
      const residual2 = Math.abs(dominantAngle(again));
      if (residual2 + 0.02 < bestResidual) {
        bestResidual = residual2;
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
  let gray = grayFromRgb(image, w, h);
  const ordered = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  let raw;
  if (split) {
    const mask = pageMask(gray);
    if (localInk) for (const box of ordered) localMask(gray, mask, w, h, box);
    raw = await readSegments(image, w, h, ordered, mask, scaleX, scaleY, runRec, dict2, signal, { gapRatio, padRatio, padYRatio, whiteRatio });
    if (orphans) raw.push(...await readOrphans(image, w, h, ordered, mask, raw, scaleX, scaleY, runRec, dict2, signal));
  } else {
    const crops = [];
    for (const box of ordered) {
      const crop = prepareCrop(image, w, h, box);
      if (crop) crops.push(crop);
    }
    raw = await readCrops(crops, scaleX, scaleY, runRec, dict2, signal);
  }
  const residual = fineSkew ? baselineSkew(raw) : null;
  if (residual != null && Math.abs(residual) >= 0.05 && Math.abs(residual) <= 1) {
    const turned = rotateRgb(image, w, h, residual);
    if (turned.w === w && turned.h === h) {
      rotateItems(raw, residual, w, h, scaleX, scaleY);
      image = turned.rgb;
      gray = grayFromRgb(image, w, h);
      deskew += residual;
    }
  }
  const fills = fillsFromCanvas(gray, w, h, scaleX);
  const rules = rulesFromCanvas(gray, w, h, scaleX, { fills });
  const items = snapOcrItems(raw);
  const frame = { rgb: image, width: w, height: h, dpi };
  await polishDirty(items, frame, page, runRec, dict2, signal);
  return { record: pageRecord(page, items, rules, ptW, ptH, dpi, deskew, fills), rgb: image, width: w, height: h, dpi };
}
async function polishDirty(items, frame, page, runRec, dict2, signal) {
  const dirty = items.filter((item) => {
    const text = item.str.trim();
    if (/^[-–—.•*·]+$/.test(text)) return false;
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
  if (msg.type === "forget") {
    pages.clear();
    return;
  }
  if (msg.type === "init") controller = new AbortController();
  const run = msg.type === "init" ? onInit(msg) : msg.type === "page" ? onPage(msg) : msg.type === "cells" ? onCells(msg) : null;
  if (run) run.catch((error) => fail(msg.id, error));
};
