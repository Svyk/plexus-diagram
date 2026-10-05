// MEM-3. Memory lane bar. Play steps one month. Snapshot ticks only move the view.

import { LANE_STEP_MS, edgeHidden, laneSets, monthSteps, previewLayout, timeIndex } from "../model/timeline.js";

export function mountMemoryLane({
  doc = globalThis.document,
  parent,
  items = [],
  edges = [],
  snapshots = [],
  now = Date.now(),
  motion = "full",
  onFrame,
  onPreview,
  schedule = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const index = timeIndex(items);
  const start = index.length ? index[0].time : now;
  const end = now;
  const steps = monthSteps(start, end);
  const bar = doc.createElement("div");
  bar.className = "pxd-memory";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Memory lane");

  const range = doc.createElement("input");
  range.type = "range";
  range.className = "pxd-memory__range";
  range.min = "0";
  range.max = String(Math.max(0, steps.length - 1));
  range.value = "0";
  range.setAttribute("aria-label", "Time");

  const play = doc.createElement("button");
  play.type = "button";
  play.className = "pxd-memory__play";
  play.textContent = "Play";

  const ticks = doc.createElement("div");
  ticks.className = "pxd-memory__ticks";
  for (const snap of snapshots) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxd-memory__tick";
    button.textContent = snap.title || "Snapshot";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const preview = previewLayout(snap.items);
      onPreview?.(preview);
    });
    ticks.append(button);
  }

  bar.append(play, range, ticks);
  parent?.append(bar);

  let timer = null;
  const at = (indexAt) => steps[Math.max(0, Math.min(steps.length - 1, indexAt))] ?? end;
  const emit = (indexAt) => {
    const t = at(indexAt);
    const sets = laneSets(index, t);
    onFrame?.({
      time: t,
      index: indexAt,
      future: sets.future,
      fresh: sets.fresh,
      hiddenEdges: edgeHidden(edges, sets.future, t),
    });
  };
  const stop = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    play.textContent = "Play";
  };
  const jump = (indexAt) => {
    range.value = String(indexAt);
    emit(indexAt);
  };

  range.addEventListener("input", () => {
    stop();
    emit(Number(range.value));
  });
  play.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (timer != null) { stop(); return; }
    if (motion === "reduced" || motion === "none") {
      jump(steps.length - 1);
      return;
    }
    play.textContent = "Stop";
    const tick = () => {
      const next = Number(range.value) + 1;
      if (next >= steps.length) { stop(); return; }
      jump(next);
      if (next >= steps.length - 1) { stop(); return; }
      timer = schedule(tick, LANE_STEP_MS);
    };
    timer = schedule(tick, LANE_STEP_MS);
  });
  emit(0);

  return {
    el: bar,
    close() {
      stop();
      bar.remove();
    },
    playing: () => timer != null,
  };
}
