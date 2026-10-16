import { lodFonts } from "../model/geometry.js";

// While the camera moves on a big board, no shell or edge joins the DOM: each attach dirtied the board for a style
// recalc of 1,000-3,500 elements and a page hit test (PhD main board at map zoom: pan p95 184-215 ms; with no
// attach in the gesture frames, 33 ms). Items that are not in the DOM yet show as plain boxes and their edges as
// hairlines on one canvas inside the world, drawn once when the gesture starts; the world transform carries it.
// The settle attaches the real shells over the boxes.
const MAX_SIDE = 2048;
// E2-1 (perf2): with `view`, only a window around the view is drawn (the view plus VIEW_PAD of it on each side), so the
// bitmap keeps the zoom's resolution: a whole PhD board at zoom 0.3 is ~5,000 screen px across, and capped at
// MAX_SIDE it was upscaled 2.5x (blurry blocks while zooming toward the map tier). covers() tells the view when the
// camera has left that window or zoomed past what the bitmap can show sharply, and it draws again (fills only).
const VIEW_PAD = 0.5;
const VIEW_PAD_MIN = 0.15;
const REUSE_MIN = 0.3;
const SHARP_UPSCALE = 1.35;
// Card titles on the map and detail looks: only at a readable size, at most this many cards (the ones in view).
const TITLE_MIN_PX = 8;
const TITLE_MAX_CARDS = 400;
const PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];

export function createGestureUnderlay({ doc, world, root, before = null } = {}) {
  let canvas = null;
  let shown = false;
  let colorCache = null;
  let lastItems = [];
  let lastUids = null;
  let drawn = null;
  // Probe (E3): bitmap redraws and reallocations (each one is a raster and an upload in the browser).
  const counts = { draws: 0, resizes: 0 };

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
    c.text = read("--pxd-text", "#1f2937");
    c.texts = {};
    for (const name of PALETTE) c.texts[name] = read(`--pxd-${name}-text`, c.text);
    let family = "";
    try { family = doc.defaultView?.getComputedStyle?.(root)?.fontFamily || ""; } catch { family = ""; }
    c.family = family || "sans-serif";
    return c;
  };

  const hide = () => {
    shown = false;
    if (canvas && canvas.style.display !== "none") canvas.style.display = "none";
  };

  // items: [{ uid, rect }] that have no shell in the DOM; edges: [[rectA, rectB]] for edges not in the DOM.
  // styled + tier (E, styledUnderlay): the boxes are drawn the way the cards look on that tier, so a shell that
  // attaches over its box does not change colour (the plain grey boxes read as cards vanishing on a coloured board).
  const draw = ({ items = [], edges = [], zoom = 1, dpr = 1, styled = false, tier = "overview", view = null } = {}) => {
    if (!items.length && !edges.length) { hide(); return 0; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { rect: r } of items) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    for (const [a, b] of edges) for (const r of [a, b]) { x0 = Math.min(x0, r.x + r.w / 2); y0 = Math.min(y0, r.y + r.h / 2); x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2); }
    const want = zoom * Math.min(dpr, 1.25);
    // E2-1: a board bigger than the bitmap at this zoom draws the window around the view only.
    const windowed = Boolean(view) && ((x1 - x0) * want > MAX_SIDE || (y1 - y0) * want > MAX_SIDE);
    if (windowed) {
      // E3-1: the pad shrinks (to VIEW_PAD_MIN) so the window fits MAX_SIDE at the zoom's resolution. With the full pad a
      // 1,400 px view was 3,066 bitmap px wide, capped to 2,048: upscaled 1.5x at once, so covers() said "not sharp"
      // on every frame and a zoom burst redrew the whole bitmap each frame (QA4 B zoom-in: a 2,048 px raster per tick).
      const padOf = (side) => Math.max(VIEW_PAD_MIN, Math.min(VIEW_PAD, (MAX_SIDE / want / side - 1) / 2));
      const px = view.w * padOf(view.w), py = view.h * padOf(view.h);
      x0 = Math.max(x0, view.x - px); y0 = Math.max(y0, view.y - py);
      x1 = Math.min(x1, view.x + view.w + px); y1 = Math.min(y1, view.y + view.h + py);
      if (!(x1 > x0 && y1 > y0)) { x0 = view.x; y0 = view.y; x1 = view.x + view.w; y1 = view.y + view.h; }
    }
    let w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const scale = Math.max(0.01, Math.min(want, MAX_SIDE / w, MAX_SIDE / h));
    // E3-1: a bitmap that already holds this window at this scale is reused (the window grows to fill it, which only
    // covers more). Reallocating a 2,048 px bitmap at each zoom step was a fresh texture each time.
    let reuse = false;
    if (canvas && canvas.width >= w * scale && canvas.height >= h * scale && w * scale * h * scale >= REUSE_MIN * canvas.width * canvas.height) {
      reuse = true;
      const gw = canvas.width / scale - w, gh = canvas.height / scale - h;
      x0 -= gw / 2; y0 -= gh / 2; w += gw; h += gh;
    }
    if (windowed) {
      const box = { x: x0, y: y0, w, h };
      items = items.filter(({ rect: r }) => r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y);
      edges = edges.filter(([a, b]) => {
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
        return Math.max(ax, bx) >= box.x && Math.min(ax, bx) <= box.x + box.w && Math.max(ay, by) >= box.y && Math.min(ay, by) <= box.y + box.h;
      });
    }
    // Colours before the canvas exists. getComputedStyle after create/insert/size forced layout in the shell frame.
    const c = styled ? paletteColors() : colors();
    if (!canvas) {
      canvas = doc.createElement("canvas");
      canvas.className = "pxd-underlay";
      canvas.setAttribute("aria-hidden", "true");
      world.insertBefore(canvas, (typeof before === "function" ? before() : before) || world.firstChild);
    }
    const bw = reuse ? canvas.width : Math.max(1, Math.ceil(w * scale)), bh = reuse ? canvas.height : Math.max(1, Math.ceil(h * scale));
    if (canvas.width !== bw || canvas.height !== bh) counts.resizes += 1;
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;pointer-events:none;`;
    let ctx = null;
    try { ctx = canvas.getContext?.("2d") || null; } catch { ctx = null; }
    if (!ctx) { hide(); return 0; }
    try {
      paint(ctx, { items, edges, c, scale, x0, y0, bw, bh, styled, tier, zoom, view });
    } catch {
      // A context that cannot draw shows nothing, the way the board looked before the underlay.
      hide();
      return 0;
    }
    counts.draws += 1;
    canvas.style.display = "";
    shown = true;
    lastItems = items;
    lastUids = null;
    drawn = { x: x0, y: y0, w, h, scale, want, whole: !windowed };
    return items.length;
  };
  // E2-1: whether the bitmap still shows `view` at `zoom` sharply (inside the drawn window, not upscaled past
  // SHARP_UPSCALE). A whole-board bitmap drawn at the zoom's own resolution covers any pan.
  const covers = (view, zoom, dpr = 1) => {
    if (!shown || !drawn || !view) return shown;
    // Measured against the resolution it was drawn for: a view wider than MAX_SIDE device px is capped whatever we do,
    // and redrawing it each frame gains nothing.
    if (zoom * Math.min(dpr, 1.25) > drawn.want * SHARP_UPSCALE) return false;
    if (drawn.whole) return true;
    return view.x >= drawn.x && view.y >= drawn.y && view.x + view.w <= drawn.x + drawn.w && view.y + view.h <= drawn.y + drawn.h;
  };
  // The uids of the boxes on the canvas now (the paint audit).
  const drawnUids = () => {
    if (!shown) return new Set();
    if (!lastUids) lastUids = new Set(lastItems.map((item) => item.uid));
    return lastUids;
  };

  // C2, the overview tier: items [{ uid, rect, color, dim, hit, selected }] (cards with no shell in the DOM), edges
  // [[rectA, rectB]] (edges not in the DOM). One fill per colour group, one stroke per outline kind, hairline edges.
  const drawOverview = ({ items = [], edges = [], zoom = 1, dpr = 1, view = null } = {}) => {
    if (!items.length && !edges.length) { hide(); return 0; }
    return draw({ items, edges, zoom, dpr, styled: true, tier: "overview", view });
  };

  // Map and detail tiers: a card is --pxd-card under its palette fill, with a 1px border in its line colour
  // (--pxd-border-strong for an uncoloured card) and an 8px radius (extension.css .pxd-item).
  const paintCards = (ctx, { items, c, scale, tier = "detail", zoom = 1, view = null }) => {
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
    // The map tile fades its palette fill in from the top (extension.css map tier gradient); half reads the same.
    for (const [fill, rects] of fills) {
      ctx.fillStyle = fill;
      ctx.globalAlpha = tier === "map" ? 0.5 : 1;
      ctx.beginPath();
      for (const r of rects) shape(r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    for (const [line, rects] of lines) {
      ctx.strokeStyle = line;
      ctx.beginPath();
      for (const r of rects) shape(r);
      ctx.stroke();
    }
    paintTitles(ctx, { items, c, tier, zoom, view });
    ctx.lineWidth = 1 / scale;
  };
  // The card header a shell shows on this tier (extension.css): 600 weight, 12 px side and 6 px top padding, the
  // palette's text colour; the map tile wraps up to three lines at --pxd-map-font, detail is one 13 px line.
  // Below a readable size the title and a detail card's body are drawn as text-coloured bars ("greeked"): a zoom-out
  // burst at detail drew dark boxes with a faint border on a dark board, which read as a blank frame (QA3 C #9-#26).
  const paintTitles = (ctx, { items, c, tier, zoom, view }) => {
    const font = tier === "map" ? lodFonts(zoom).map : 13;
    const lines = tier === "map" ? 3 : 1;
    const lineH = font * 1.2;
    if (font * zoom < TITLE_MIN_PX || typeof ctx.fillText !== "function") { paintGreek(ctx, { items, c, tier, font, lines, lineH }); return; }
    if (tier === "detail") paintGreek(ctx, { items, c, tier, font, lines, lineH, bodyOnly: true });
    ctx.font = `600 ${font}px ${c.family}`;
    ctx.textBaseline = "top";
    const fit = (text, width) => {
      if (typeof ctx.measureText !== "function" || ctx.measureText(text).width <= width) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid; else hi = mid - 1; }
      return `${text.slice(0, lo)}…`;
    };
    let n = 0;
    for (const item of items) {
      const title = String(item.title || "").trim();
      if (!title) continue;
      const r = item.rect;
      if (view && !(r.x < view.x + view.w && r.x + r.w > view.x && r.y < view.y + view.h && r.y + r.h > view.y)) continue;
      if (++n > TITLE_MAX_CARDS) break;
      const width = r.w - 24;
      if (width <= font) continue;
      const name = item.color && c.texts?.[item.color] ? item.color : "";
      ctx.fillStyle = name ? c.texts[name] : c.text;
      const room = Math.max(1, Math.min(lines, Math.floor((r.h - 12) / lineH)));
      const words = title.split(/\s+/);
      let row = 0;
      let line = "";
      for (let i = 0; i < words.length && row < room; i += 1) {
        const next = line ? `${line} ${words[i]}` : words[i];
        if (!line || typeof ctx.measureText !== "function" || ctx.measureText(next).width <= width) { line = next; continue; }
        const last = row === room - 1;
        ctx.fillText(last ? fit(`${line} ${words.slice(i).join(" ")}`, width) : line, r.x + 12, r.y + 6 + row * lineH);
        row += 1;
        line = last ? "" : words[i];
        if (last) break;
      }
      if (line && row < room) ctx.fillText(fit(line, width), r.x + 12, r.y + 6 + row * lineH);
    }
  };

  const paintGreek = (ctx, { items, c, tier, font, lines, lineH, bodyOnly = false }) => {
    const charW = font * 0.55;
    for (const item of items) {
      const r = item.rect;
      const width = r.w - 24;
      if (width <= 0) continue;
      const name = item.color && c.texts?.[item.color] ? item.color : "";
      ctx.fillStyle = name ? c.texts[name] : c.text;
      if (!bodyOnly) {
        const title = String(item.title || "").trim();
        if (title) {
          ctx.globalAlpha = 0.55;
          const room = Math.max(1, Math.min(lines, Math.floor((r.h - 12) / lineH)));
          let left = title.length * charW;
          for (let row = 0; row < room && left > 0; row += 1) {
            const bar = Math.min(width, left);
            ctx.fillRect(r.x + 12, r.y + 6 + row * lineH + font * 0.25, bar, font * 0.6);
            left -= width;
          }
        }
      }
      // A detail card shows its body under a ~32 px header: a few faint lines.
      if (tier === "detail" && r.h > 56) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = c.text;
        const rows = Math.min(4, Math.floor((r.h - 44) / 19));
        for (let row = 0; row < rows; row += 1) ctx.fillRect(r.x + 12, r.y + 40 + row * 19, width * (row === rows - 1 ? 0.6 : 0.9 - (row % 2) * 0.08), 6.5);
      }
    }
    ctx.globalAlpha = 1;
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

  const paint = (ctx, { items, edges, c, scale, x0, y0, bw, bh, styled = false, tier = "overview", zoom = 1, view = null }) => {
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
    if (styled) { paintCards(ctx, { items, c, scale, tier, zoom, view }); return; }
    ctx.fillStyle = c.card;
    for (const { rect: r } of items) ctx.fillRect(r.x, r.y, r.w, r.h);
  };

  const dispose = () => {
    try { canvas?.remove?.(); } catch { /* gone */ }
    canvas = null;
    shown = false;
  };
  const dropColors = () => { colorCache = null; };

  return { draw, drawOverview, hide, dispose, dropColors, drawnUids, covers, stats: () => ({ ...counts }), isShown: () => shown, element: () => canvas };
}
