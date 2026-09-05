/** SVG path helpers for diagram connections. */

const SIDE_NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function sidePoint(rect, side) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  if (side === "auto") return { x: cx, y: cy };
  if (side === "top") return { x: cx, y: rect.y };
  if (side === "right") return { x: rect.x + rect.width, y: cy };
  if (side === "bottom") return { x: cx, y: rect.y + rect.height };
  if (side === "left") return { x: rect.x, y: cy };
  return { x: cx, y: cy };
}

function facingSide(rect, point) {
  let best = "left";
  let bestDot = -Infinity;
  for (const side of ["top", "right", "bottom", "left"]) {
    const sp = sidePoint(rect, side);
    const nx = point.x - sp.x;
    const ny = point.y - sp.y;
    const normal = SIDE_NORMALS[side];
    const dot = normal.x * nx + normal.y * ny;
    if (dot > bestDot) {
      bestDot = dot;
      best = side;
    }
  }
  return best;
}

function autoEndpoints(sourceRect, targetRect) {
  const scx = sourceRect.x + sourceRect.width / 2;
  const scy = sourceRect.y + sourceRect.height / 2;
  const tcx = targetRect.x + targetRect.width / 2;
  const tcy = targetRect.y + targetRect.height / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;
  let sx = scx;
  let sy = scy;
  let tx = tcx;
  let ty = tcy;
  if (Math.abs(dx) > Math.abs(dy)) {
    sx = dx > 0 ? sourceRect.x + sourceRect.width : sourceRect.x;
    tx = dx > 0 ? targetRect.x : targetRect.x + targetRect.width;
    sy = scy;
    ty = tcy;
  } else {
    sy = dy > 0 ? sourceRect.y + sourceRect.height : sourceRect.y;
    ty = dy > 0 ? targetRect.y : targetRect.y + targetRect.height;
    sx = scx;
    tx = tcx;
  }
  return { sx, sy, tx, ty };
}

export function edgeEndpoints(sourceRect, targetRect, from = "auto", to = "auto") {
  if (from === "sides") {
    from = "auto";
    to = "auto";
  }

  if (from === "auto" && to === "auto") {
    return autoEndpoints(sourceRect, targetRect);
  }

  if (from !== "auto" && to !== "auto") {
    const sp = sidePoint(sourceRect, from);
    const tp = sidePoint(targetRect, to);
    return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y };
  }

  if (from !== "auto") {
    const sp = sidePoint(sourceRect, from);
    const tp = sidePoint(targetRect, facingSide(targetRect, sp));
    return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y };
  }

  const tp = sidePoint(targetRect, to);
  const sp = sidePoint(sourceRect, facingSide(sourceRect, tp));
  return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y };
}

export function straightPath(sx, sy, tx, ty) {
  return `M ${sx} ${sy} L ${tx} ${ty}`;
}

export function bezierPath(sx, sy, tx, ty, from = "auto", to = "auto") {
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const offset = Math.max(40, Math.min(dx, dy) * 0.5);

  if (from === "auto" && to === "auto") {
    if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
      const c1x = sx + (tx > sx ? offset : -offset);
      const c2x = tx + (tx > sx ? -offset : offset);
      return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
    }
    const c1y = sy + (ty > sy ? offset : -offset);
    const c2y = ty + (ty > sy ? -offset : offset);
    return `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`;
  }

  let c1x = sx;
  let c1y = sy;
  let c2x = tx;
  let c2y = ty;

  if (from === "top") c1y = sy - offset;
  else if (from === "bottom") c1y = sy + offset;
  else if (from === "right") c1x = sx + offset;
  else if (from === "left") c1x = sx - offset;
  else if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
    c1x = sx + (tx > sx ? offset : -offset);
  } else {
    c1y = sy + (ty > sy ? offset : -offset);
  }

  if (to === "top") c2y = ty - offset;
  else if (to === "bottom") c2y = ty + offset;
  else if (to === "right") c2x = tx + offset;
  else if (to === "left") c2x = tx - offset;
  else if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
    c2x = tx + (tx > sx ? -offset : offset);
  } else {
    c2y = ty + (ty > sy ? -offset : offset);
  }

  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
}

export function elbowPath(sx, sy, tx, ty) {
  const midX = (sx + tx) / 2;
  return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
}

export function buildEdgePath(style, sourceRect, targetRect, from = "auto", to = "auto") {
  const { sx, sy, tx, ty } = edgeEndpoints(sourceRect, targetRect, from, to);
  if (style === "straight") return straightPath(sx, sy, tx, ty);
  if (style === "elbow") return elbowPath(sx, sy, tx, ty);
  return bezierPath(sx, sy, tx, ty, from, to);
}

export function edgeMidpoint(sourceRect, targetRect, from = "auto", to = "auto") {
  const { sx, sy, tx, ty } = edgeEndpoints(sourceRect, targetRect, from, to);
  return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
}

export function arrowheadMarkerId(kind, canvasId = "", colorId = "default") {
  return `pxd-arrow-${kind}-${canvasId}-${colorId || "default"}`;
}

export function arrowheadSize(zoom) {
  return Math.min(24, Math.max(6, 10 / zoom));
}

export function shouldRescaleMarkers(prev, next) {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === 0) return false;
  return Math.abs(next - prev) / Math.abs(prev) >= 0.05;
}

export function directionToPoints(direction) {
  if (direction === "twoWay") return { start: true, end: true };
  if (direction === "none") return { start: false, end: false };
  return { start: false, end: true };
}

export function effectiveDirection(edge, setting) {
  const direction = edge?.direction;
  if (direction === "oneWay" || direction === "twoWay" || direction === "none") {
    return direction;
  }
  if (setting === "both") return "twoWay";
  if (setting === "none") return "none";
  return "oneWay";
}

export function arrowheadPoints(arrowheads) {
  if (arrowheads === "none") return { start: false, end: false };
  if (arrowheads === "both") return { start: true, end: true };
  return { start: false, end: true };
}
