// 8-connected components with first and second moments. Shared by detection boxes and rules.

export function labelComponents(mask, width, height) {
  const n = width * height;
  const labels = new Int32Array(n);
  const parent = [0];
  let next = 1;
  const find = (a) => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== a) { const p = parent[a]; parent[a] = root; a = p; }
    return root;
  };
  const unite = (a, b) => {
    a = find(a); b = find(b);
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
  const acc = new Map();
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
      c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
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
