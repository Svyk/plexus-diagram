// While the camera moves on a big board, no shell or edge joins the DOM: each attach dirtied the board for a style
// recalc of 1,000-3,500 elements and a page hit test (PhD main board at map zoom: pan p95 184-215 ms; with no
// attach in the gesture frames, 33 ms). Items that are not in the DOM yet show as plain boxes and their edges as
// hairlines on one canvas inside the world, drawn once when the gesture starts; the world transform carries it.
// The settle attaches the real shells over the boxes.
const MAX_SIDE = 2048;
const PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];

export function createGestureUnderlay({ doc, world, root, before = null } = {}) {
  let canvas = null;
  let shown = false;
  let colorCache = null;
  let lastItems = [];
  let lastUids = null;

  const colors = () => {
    if (colorCache) return colorCache;
    const read = (name, fallback) => {
      let v = "";
      try { v = root?.style?.getPropertyValue?.(name) || ""; } catch { v = ""; }
      if (!v) {
        try { v = doc.defaultView?.getComputedStyle?.(root)?.getPropertyValue?.(name) || ""; } catch { v = ""; }
      }
      return String(v).trim() || fallback;
    };
    colorCache = { card: read("--pxd-card", "rgba(128,128,128,0.35)"), line: read("--pxd-muted", "rgba(128,128,128,0.6)") };
    return colorCache;
  };
  // The overview tier reads a coloured card by its line colour (extension.css, overview tier); the rest are the card
  // colour with a hairline border. Read once per theme (dropColors).
  const paletteColors = () => {
    const c = colors();
    if (c.palette) return c;
    const read = (name, fallback) => {
      let v = "";
      try { v = root?.style?.getPropertyValue?.(name) || ""; } catch { v = ""; }
      if (!v) {
        try { v = doc.defaultView?.getComputedStyle?.(root)?.getPropertyValue?.(name) || ""; } catch { v = ""; }
      }
      return String(v).trim() || fallback;
    };
    c.palette = {};
    c.fills = {};
    for (const name of PALETTE) {
      c.palette[name] = read(`--pxd-${name}-line`, c.line);
      const fill = read(`--pxd-${name}-fill`, "");
      c.fills[name] = !fill || fill === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(fill) ? "" : fill;
    }
    c.accent = read("--pxd-accent", "hsl(175 80% 30%)");
    c.border = read("--pxd-border", c.line);
    c.borderStrong = read("--pxd-border-strong", c.border);
    return c;
  };

  const hide = () => {
    shown = false;
    if (canvas && canvas.style.display !== "none") canvas.style.display = "none";
  };

  // items: [{ uid, rect }] that have no shell in the DOM; edges: [[rectA, rectB]] for edges not in the DOM.
  // styled + tier (E, styledUnderlay): the boxes are drawn the way the cards look on that tier, so a shell that
  // attaches over its box does not change colour (the plain grey boxes read as cards vanishing on a coloured board).
  const draw = ({ items = [], edges = [], zoom = 1, dpr = 1, styled = false, tier = "overview" } = {}) => {
    if (!items.length && !edges.length) { hide(); return 0; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { rect: r } of items) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    for (const [a, b] of edges) for (const r of [a, b]) { x0 = Math.min(x0, r.x + r.w / 2); y0 = Math.min(y0, r.y + r.h / 2); x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2); }
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const scale = Math.max(0.01, Math.min(zoom * Math.min(dpr, 1.25), MAX_SIDE / w, MAX_SIDE / h));
    // Colours before the canvas exists. getComputedStyle after create/insert/size forced layout in the shell frame.
    const c = styled ? paletteColors() : colors();
    if (!canvas) {
      canvas = doc.createElement("canvas");
      canvas.className = "pxd-underlay";
      canvas.setAttribute("aria-hidden", "true");
      world.insertBefore(canvas, (typeof before === "function" ? before() : before) || world.firstChild);
    }
    const bw = Math.max(1, Math.ceil(w * scale)), bh = Math.max(1, Math.ceil(h * scale));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;pointer-events:none;`;
    let ctx = null;
    try { ctx = canvas.getContext?.("2d") || null; } catch { ctx = null; }
    if (!ctx) { hide(); return 0; }
    try {
      paint(ctx, { items, edges, c, scale, x0, y0, bw, bh, styled, tier });
    } catch {
      // A context that cannot draw shows nothing, the way the board looked before the underlay.
      hide();
      return 0;
    }
    canvas.style.display = "";
    shown = true;
    lastItems = items;
    lastUids = null;
    return items.length;
  };
  // The uids of the boxes on the canvas now (the paint audit).
  const drawnUids = () => {
    if (!shown) return new Set();
    if (!lastUids) lastUids = new Set(lastItems.map((item) => item.uid));
    return lastUids;
  };

  // C2, the overview tier: items [{ uid, rect, color, dim, hit, selected }] (cards with no shell in the DOM), edges
  // [[rectA, rectB]] (edges not in the DOM). One fill per colour group, one stroke per outline kind, hairline edges.
  const drawOverview = ({ items = [], edges = [], zoom = 1, dpr = 1 } = {}) => {
    if (!items.length && !edges.length) { hide(); return 0; }
    return draw({ items, edges, zoom, dpr, styled: true, tier: "overview" });
  };

  // Map and detail tiers: a card is --pxd-card under its palette fill, with a 1px border in its line colour
  // (--pxd-border-strong for an uncoloured card) and an 8px radius (extension.css .pxd-item).
  const paintCards = (ctx, { items, c, scale }) => {
    const round = typeof ctx.roundRect === "function";
    const shape = (r) => { if (round) ctx.roundRect(r.x, r.y, r.w, r.h, 8); else ctx.rect(r.x, r.y, r.w, r.h); };
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.card;
    ctx.beginPath();
    for (const { rect } of items) shape(rect);
    ctx.fill();
    const fills = new Map();
    const lines = new Map();
    for (const item of items) {
      const name = item.color && c.palette?.[item.color] ? item.color : "";
      const fill = name ? c.fills[name] : "";
      if (fill) { if (!fills.has(fill)) fills.set(fill, []); fills.get(fill).push(item.rect); }
      const line = name ? c.palette[name] : c.borderStrong;
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push(item.rect);
    }
    for (const [fill, rects] of fills) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const r of rects) shape(r);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    for (const [line, rects] of lines) {
      ctx.strokeStyle = line;
      ctx.beginPath();
      for (const r of rects) shape(r);
      ctx.stroke();
    }
    ctx.lineWidth = 1 / scale;
  };

  const paintStyled = (ctx, { items, c, scale }) => {
    const groups = new Map();
    const outline = [];
    const marked = [];
    for (const item of items) {
      const fill = item.color && c.palette?.[item.color] ? c.palette[item.color] : c.card;
      const key = `${fill}\0${item.dim ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) { list = { fill, dim: Boolean(item.dim), rects: [] }; groups.set(key, list); }
      list.rects.push(item.rect);
      if (!item.color || !c.palette?.[item.color]) outline.push(item.rect);
      if (item.hit || item.selected) marked.push(item.rect);
    }
    for (const { fill, dim, rects } of groups.values()) {
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.fillStyle = fill;
      for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (outline.length) {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (const r of outline) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
    }
    if (marked.length) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      for (const r of marked) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const paint = (ctx, { items, edges, c, scale, x0, y0, bw, bh, styled = false, tier = "overview" }) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    if (edges.length) {
      ctx.strokeStyle = c.line;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
        ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (styled && tier === "overview") { paintStyled(ctx, { items, c, scale }); return; }
    if (styled) { paintCards(ctx, { items, c, scale }); return; }
    ctx.fillStyle = c.card;
    for (const { rect: r } of items) ctx.fillRect(r.x, r.y, r.w, r.h);
  };

  const dispose = () => {
    try { canvas?.remove?.(); } catch { /* gone */ }
    canvas = null;
    shown = false;
  };
  const dropColors = () => { colorCache = null; };

  return { draw, drawOverview, hide, dispose, dropColors, drawnUids, isShown: () => shown, element: () => canvas };
}
