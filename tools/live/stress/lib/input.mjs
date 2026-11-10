// Real (trusted) input through CDP. Bench window only; coordinates are CSS pixels of the page.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };
export const mods = (m) => (typeof m === "number" ? m : (m || []).reduce((a, k) => a | (MOD[String(k).toLowerCase()] || 0), 0));

// wait until an absolute performance.now() time: timer for the bulk, spin for the last ~1 ms
async function sleepUntil(t) {
  const left = t - performance.now();
  if (left > 2) await sleep(left - 1.5);
  while (performance.now() < t) { /* spin */ }
}

const NAMED = { Enter: ["Enter", 13, "\r"], Escape: ["Escape", 27], Backspace: ["Backspace", 8], Delete: ["Delete", 46], Tab: ["Tab", 9], ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40], " ": ["Space", 32] };
function keyDef(key) {
  if (NAMED[key]) return { code: NAMED[key][0], vk: NAMED[key][1] };
  if (/^[a-z]$/i.test(key)) return { code: "Key" + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(key)) return { code: "Digit" + key, vk: key.charCodeAt(0) };
  return {};
}

export function createInput(c) {
  if (!c || c.role !== "bench") throw new Error("createInput needs a bench connection (role \"bench\")");
  const mouse = (type, x, y, o = {}) => c.send("Input.dispatchMouseEvent", { type, x, y, button: o.button ?? "none", buttons: o.buttons ?? 0, clickCount: o.clickCount ?? 0, modifiers: mods(o.mods), ...(o.extra || {}) });
  const btnMask = (b) => (b === "left" ? 1 : b === "right" ? 2 : b === "middle" ? 4 : 0);

  const move = (x, y, o = {}) => mouse("mouseMoved", x, y, { mods: o.mods, buttons: o.buttons ?? 0 });
  const down = (x, y, { button = "left", count = 1, mods: m } = {}) => mouse("mousePressed", x, y, { button, buttons: btnMask(button), clickCount: count, mods: m });
  const up = (x, y, { button = "left", count = 1, mods: m } = {}) => mouse("mouseReleased", x, y, { button, buttons: 0, clickCount: count, mods: m });
  async function click(x, y, { count = 1, button = "left", mods: m, gap = 30 } = {}) {
    await move(x, y, { mods: m });
    for (let i = 1; i <= count; i++) {
      await down(x, y, { button, count: i, mods: m });
      await up(x, y, { button, count: i, mods: m });
      if (i < count) await sleep(gap);
    }
  }
  const dblclick = (x, y, o = {}) => click(x, y, { ...o, count: 2 });
  async function drag({ x1, y1, x2, y2, steps = 12, delay = 16, mods: m, hold = 0 }) {
    await move(x1, y1, { mods: m });
    await down(x1, y1, { mods: m });
    for (let i = 1; i <= steps; i++) {
      await mouse("mouseMoved", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, { button: "left", buttons: 1, mods: m });
      await sleep(delay);
    }
    if (hold) await sleep(hold);
    await up(x2, y2, { mods: m });
  }
  const wheel = (x, y, { dx = 0, dy = 0, mods: m } = {}) => c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy, button: "none", buttons: 0, modifiers: mods(m) });

  // events go out on an absolute schedule without waiting for replies, as a trackpad does
  async function wheelSeries(x, y, list, { maxInFlight = 8 } = {}) {
    const start = performance.now();
    const pending = [];
    let at = 0, late = 0, behind = 0, n = 0;
    for (const row of list) {
      at += row.dt || 0;
      const slot = start + at;
      await sleepUntil(slot);
      const sent = performance.now();
      behind = Math.max(behind, sent - slot);
      const p = wheel(x, y, { dx: row.dx || 0, dy: row.dy || 0, mods: row.mods }).then(() => { late = Math.max(late, performance.now() - sent); }, () => {});
      pending.push(p);
      n++;
      while (pending.length > maxInFlight) await pending.shift();
    }
    await Promise.all(pending);
    return { n, ms: performance.now() - start, late, behind };
  }
  async function pan({ x, y, dx, dy, ms, hz = 60, mods: m }) {
    const n = Math.max(1, Math.round((ms * hz) / 1000));
    const dt = ms / n;
    const list = [];
    let sx = 0, sy = 0;
    for (let i = 1; i <= n; i++) {
      // integer-free: carry the fractional part so the sum is exact
      const tx = (dx * i) / n, ty = (dy * i) / n;
      list.push({ dt: i === 1 ? 0 : dt, dx: tx - sx, dy: ty - sy, mods: m });
      sx = tx; sy = ty;
    }
    return wheelSeries(x, y, list);
  }
  async function flick({ x, y, vx = 0, vy = 0, hz = 120, ramp = 6, decay = 0.955, min = 0.5, mods: m }) {
    const dt = 1000 / hz;
    const list = [];
    for (let i = 1; i <= ramp; i++) list.push({ dt: i === 1 ? 0 : dt, dx: (vx * i) / ramp, dy: (vy * i) / ramp, mods: m });
    let cx = vx, cy = vy;
    for (let k = 0; k < 2000; k++) {
      cx *= decay; cy *= decay;
      if (Math.abs(cx) < min && Math.abs(cy) < min) break;
      list.push({ dt, dx: cx, dy: cy, mods: m });
    }
    const r = await wheelSeries(x, y, list);
    return { n: r.n, ms: r.ms, dx: list.reduce((a, e) => a + e.dx, 0), dy: list.reduce((a, e) => a + e.dy, 0) };
  }
  const burst = ({ x, y, dx = 0, dy = 0, n, hz = 60, mods: m }) => wheelSeries(x, y, Array.from({ length: n }, (_, i) => ({ dt: i === 0 ? 0 : 1000 / hz, dx, dy, mods: m })));
  // pinch-style zoom: meta+wheel. factor > 1 zooms in (negative dy); the per-event dy is ln(factor) * 100 / n when factor is given, else stepDy
  async function zoom({ x, y, factor, ms = 400, hz = 60, stepDy = 4, mods: m }) {
    const n = Math.max(1, Math.round((ms * hz) / 1000));
    const per = factor && factor > 0 && factor !== 1 ? (-Math.log(factor) * 100) / n : -stepDy;
    return burst({ x, y, dy: per, n, hz, mods: mods(m) | 4 });
  }

  async function key(k, { code, vk, mods: m, text } = {}) {
    const d = keyDef(k);
    const base = { key: k, code: code ?? d.code, windowsVirtualKeyCode: vk ?? d.vk, nativeVirtualKeyCode: vk ?? d.vk, modifiers: mods(m) };
    if (text != null) await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text, unmodifiedText: text });
    else await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async function type(str, { interval = 60 } = {}) {
    const start = performance.now();
    let n = 0;
    for (const ch of str) {
      await sleepUntil(start + n * interval);
      await key(ch === "\n" ? "Enter" : ch, { text: ch === "\n" ? "\r" : ch });
      n++;
    }
    return { n, ms: performance.now() - start };
  }
  const text = (s) => c.send("Input.insertText", { text: s });

  return { move, down, up, click, dblclick, drag, wheel, wheelSeries, pan, flick, burst, zoom, key, text, type, mods };
}
