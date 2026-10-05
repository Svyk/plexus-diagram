// Memory lane index. No Roam calls. Play is 700ms per month so two years finish under 20s.

export const LANE_STEP_MS = 700;
const WEEK = 7 * 86400000;

export function timeIndex(items) {
  const events = [];
  for (const item of items || []) {
    if (!item?.uid || !Number.isFinite(item.time)) continue;
    events.push({ uid: item.uid, time: item.time, kind: item.kind || "card" });
  }
  events.sort((a, b) => a.time - b.time || String(a.uid).localeCompare(String(b.uid)));
  return events;
}

export function monthSteps(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b.getTime() <= a.getTime()) {
    return [Number.isFinite(a.getTime()) ? a.getTime() : Date.now()];
  }
  const steps = [a.getTime()];
  let year = a.getFullYear();
  let month = a.getMonth();
  const endT = b.getTime();
  for (let i = 0; i < 600; i += 1) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    const t = new Date(year, month, 1).getTime();
    if (t >= endT) {
      steps.push(endT);
      break;
    }
    steps.push(t);
  }
  return steps;
}

export function playMs(start, end, stepMs = LANE_STEP_MS) {
  return Math.max(0, monthSteps(start, end).length - 1) * stepMs;
}

export function laneSets(index, t) {
  const future = [];
  const fresh = [];
  for (const event of index || []) {
    if (event.time > t) future.push(event.uid);
    else if (t - event.time <= WEEK) fresh.push(event.uid);
  }
  return { future, fresh };
}

export function edgeHidden(edges, itemFuture, t) {
  const late = new Set(itemFuture || []);
  const out = [];
  for (const edge of edges || []) {
    if (!edge?.uid) continue;
    const own = Number.isFinite(edge.time) && edge.time > t;
    if (own || late.has(edge.from) || late.has(edge.to)) out.push(edge.uid);
  }
  return out;
}

export function previewLayout(items) {
  const layout = new Map();
  for (const item of items || []) {
    if (!item?.uid || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    layout.set(item.uid, { x: item.x, y: item.y, w: item.w, h: item.h });
  }
  return { layout, writes: 0 };
}
