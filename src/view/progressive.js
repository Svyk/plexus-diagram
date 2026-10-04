// EK-3: progressive page-card rows. A page card paints every row as plain text at once (cheap DOM), then upgrades
// the rows that are on screen to live Roam renders in idle chunks. Rows that are off screen wait until the body
// scrolls them in. Heavy rows (roam/render, embeds, images, boards) upgrade only when their row is on screen and
// after the light rows. This file is the scheduling only; the DOM work is the caller's `render(id)`.

const HEAVY_RE = /\{\{\s*(?:\[\[)?(?:roam\/render|embed[\w-]*|video|youtube|iframe|pdf|query|diagram|table|calc)|!\[[^\]]*\]\(|<iframe/i;

export const isHeavyRow = (string) => HEAVY_RE.test(String(string || ""));

export function createRowScheduler({ idle, now = () => Date.now(), budgetMs = 8, render } = {}) {
  const rows = new Map(); // id -> { id, heavy, wanted, done }
  let handle = null;
  let disposed = false;
  let queued = false;

  const pending = () => {
    const light = [];
    const heavy = [];
    for (const row of rows.values()) {
      if (row.done || !row.wanted) continue;
      (row.heavy ? heavy : light).push(row);
    }
    return light.concat(heavy);
  };

  const finish = (row) => {
    if (row.done) return;
    row.done = true;
    try { render(row.id); } catch { /* the row stays plain */ }
  };

  const pump = (deadline) => {
    handle = null;
    queued = false;
    if (disposed) return;
    const start = now();
    const has = deadline && typeof deadline.timeRemaining === "function" ? () => deadline.timeRemaining() > 1 : () => true;
    for (const row of pending()) {
      if (now() - start >= budgetMs || !has()) break;
      finish(row);
    }
    if (pending().length) schedule();
  };

  const schedule = () => {
    if (disposed || queued || !pending().length) return;
    queued = true;
    handle = idle(pump);
  };

  return {
    // Registers a row. `wanted` starts false when the caller watches visibility, true when it cannot.
    add(id, { heavy = false, wanted = false } = {}) {
      if (rows.has(id)) return;
      rows.set(id, { id, heavy: Boolean(heavy), wanted: Boolean(wanted), done: false });
      if (wanted) schedule();
    },
    want(id, on = true) {
      const row = rows.get(id);
      if (!row || row.done) return;
      row.wanted = Boolean(on);
      if (on) schedule();
    },
    wantAll() {
      for (const row of rows.values()) row.wanted = true;
      schedule();
    },
    // Renders one row right now (reveal, scroll to it, measure it).
    renderNow(id) {
      const row = rows.get(id);
      if (!row) return false;
      finish(row);
      return true;
    },
    isDone: (id) => Boolean(rows.get(id)?.done),
    size: () => rows.size,
    pending: () => pending().length,
    dispose() {
      disposed = true;
      try { if (typeof handle === "function") handle(); } catch { /* already cancelled */ }
      handle = null;
      rows.clear();
    },
  };
}
