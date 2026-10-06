// EK-3: progressive page-card rows. A page card paints every row as plain text at once (cheap DOM), then upgrades
// the rows that are on screen to live Roam renders in idle chunks. Rows that are off screen wait until the body
// scrolls them in. Heavy rows (roam/render, embeds, images, boards) upgrade only when their row is on screen and
// after the light rows. This file is the scheduling only; the DOM work is the caller's `render(id)`.

const HEAVY_RE = /\{\{\s*(?:\[\[)?(?:roam\/render|embed[\w-]*|video|youtube|iframe|pdf|query|diagram|table|calc)|!\[[^\]]*\]\(|<iframe/i;

export const isHeavyRow = (string) => HEAVY_RE.test(String(string || ""));

// Median rAF delta during the open's pumps, as frames per second. One stamp has no delta.
export function mountFpsFromStamps(stamps) {
  const deltas = [];
  const list = Array.isArray(stamps) ? stamps : [];
  for (let i = 1; i < list.length; i += 1) {
    const d = Number(list[i]) - Number(list[i - 1]);
    if (d > 0 && Number.isFinite(d)) deltas.push(d);
  }
  if (!deltas.length) return null;
  deltas.sort((a, b) => a - b);
  const mid = deltas[Math.floor((deltas.length - 1) * 0.5)];
  const fps = 1000 / mid;
  return Number.isFinite(fps) ? Math.round(fps) : null;
}

export function createRowScheduler({ idle, now = () => Date.now(), budgetMs = 8, render, eager = null } = {}) {
  const rows = new Map(); // id -> { id, heavy, wanted, done, near, seq }
  let handle = null;
  let disposed = false;
  let queued = false;
  let held = false;
  let seq = 0;

  // Light rows before heavy ones. `near` (squared distance to the viewport centre) orders a bucket;
  // rows that never set it keep insertion order, which is what page cards rely on.
  const byOrder = (a, b) => {
    const an = a.near;
    const bn = b.near;
    if (an != null && bn != null && an !== bn) return an - bn;
    return a.seq - b.seq;
  };
  const pending = () => {
    const light = [];
    const heavy = [];
    for (const row of rows.values()) {
      if (row.done || !row.wanted) continue;
      (row.heavy ? heavy : light).push(row);
    }
    light.sort(byOrder);
    heavy.sort(byOrder);
    return light.concat(heavy);
  };

  // `false` from render means "not this turn" (paused, scrolled away). A throw still counts as done.
  const finish = (row) => {
    if (row.done) return;
    row.done = true;
    let retry = false;
    try { retry = render(row.id) === false; } catch { retry = false; }
    if (retry) row.done = false;
  };

  let pumping = false;
  const allNow = () => {
    try { return typeof eager === "function" && eager() === true; } catch { return false; }
  };

  const pump = (deadline) => {
    handle = null;
    queued = false;
    if (disposed || held) return;
    const start = now();
    const open = allNow();
    const has = deadline && typeof deadline.timeRemaining === "function" ? () => deadline.timeRemaining() > 1 : () => true;
    for (const row of pending()) {
      // Read around the mount: the previous render advanced `now`, so a row that would start past the budget waits.
      if (!open && (held || now() - start >= budgetMs || !has())) break;
      finish(row);
    }
    if (!held && pending().length) schedule();
  };

  const schedule = () => {
    if (disposed || held || queued || !pending().length) return;
    // FAST-9. Card bodies with budgeted mounting off finish in this turn. A retry stays pending.
    if (allNow()) {
      if (pumping) return;
      pumping = true;
      try { pump(null); } finally { pumping = false; }
      return;
    }
    queued = true;
    handle = idle(pump);
  };

  return {
    // Registers a row. `wanted` starts false when the caller watches visibility, true when it cannot.
    add(id, { heavy = false, wanted = false, near = null } = {}) {
      if (rows.has(id)) return;
      rows.set(id, { id, heavy: Boolean(heavy), wanted: Boolean(wanted), done: false, near, seq: seq++ });
      if (wanted) schedule();
    },
    // Card bodies update distance as the camera moves. A finished row stays finished until reopen.
    place(id, { heavy = false, near = null, wanted = true } = {}) {
      let row = rows.get(id);
      if (!row) {
        row = { id, heavy: Boolean(heavy), wanted: false, done: false, near, seq: seq++ };
        rows.set(id, row);
      } else if (row.done) {
        return;
      } else {
        row.heavy = Boolean(heavy);
        if (near != null) row.near = near;
      }
      row.wanted = Boolean(wanted);
      if (wanted) schedule();
    },
    // A dirty uid whose body was cleared mounts again. Already-done uids outside the dirty set never get here.
    reopen(id, opts = {}) {
      const row = rows.get(id);
      if (!row) {
        this.place(id, opts);
        return true;
      }
      row.done = false;
      row.heavy = Boolean(opts.heavy);
      if (opts.near != null) row.near = opts.near;
      row.wanted = opts.wanted !== false;
      if (row.wanted) schedule();
      return true;
    },
    // A gesture holds the pump so a pan frame does not mount bodies. Release continues the same rows.
    hold(on = true) {
      held = Boolean(on);
      if (held) {
        try { if (typeof handle === "function") handle(); } catch { /* already cancelled */ }
        handle = null;
        queued = false;
        return;
      }
      schedule();
    },
    want(id, on = true) {
      const row = rows.get(id);
      if (!row || row.done) return;
      row.wanted = Boolean(on);
      if (on) schedule();
    },
    // A refresh drops a row that left the outline. A string edit can flip heavy without starting over.
    drop(id) {
      rows.delete(id);
    },
    retarget(id, { heavy = false } = {}) {
      const row = rows.get(id);
      if (!row || row.done) return;
      row.heavy = Boolean(heavy);
      if (row.wanted) schedule();
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
