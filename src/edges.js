/** SVG path helpers for diagram connections. */

export function edgeEndpoints(sourceRect, targetRect, side = "auto") {
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
  if (side === "auto" || side === "sides") {
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
  }
  return { sx, sy, tx, ty };
}

export function straightPath(sx, sy, tx, ty) {
  return `M ${sx} ${sy} L ${tx} ${ty}`;
}

export function bezierPath(sx, sy, tx, ty) {
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const offset = Math.max(40, Math.min(dx, dy) * 0.5);
  if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
    const c1x = sx + (tx > sx ? offset : -offset);
    const c2x = tx + (tx > sx ? -offset : offset);
    return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
  }
  const c1y = sy + (ty > sy ? offset : -offset);
  const c2y = ty + (ty > sy ? -offset : offset);
  return `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`;
}

export function elbowPath(sx, sy, tx, ty) {
  const midX = (sx + tx) / 2;
  return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
}

export function buildEdgePath(style, sourceRect, targetRect) {
  const { sx, sy, tx, ty } = edgeEndpoints(sourceRect, targetRect);
  if (style === "straight") return straightPath(sx, sy, tx, ty);
  if (style === "elbow") return elbowPath(sx, sy, tx, ty);
  return bezierPath(sx, sy, tx, ty);
}

export function edgeMidpoint(sourceRect, targetRect) {
  const { sx, sy, tx, ty } = edgeEndpoints(sourceRect, targetRect);
  return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
}

export function arrowheadMarkerId(kind) {
  return `pxd-arrow-${kind}`;
}

export function arrowheadPoints(arrowheads) {
  if (arrowheads === "none") return { start: false, end: false };
  if (arrowheads === "both") return { start: true, end: true };
  return { start: false, end: true };
}
