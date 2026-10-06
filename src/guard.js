// REL-5. One guard for timers, observers, and pull watches.
// The first throw of a signature logs once. The 20th throw of that signature
// inside 60 seconds silences that callback until the minute has passed.

const WINDOW_MS = 60000;
const TRIP = 20;

let sharedStats = null;
const loggedSignatures = new Set();
const listeners = new Set();

export function bindGuardStats(stats) {
  if (stats && typeof stats === "object") sharedStats = stats;
}

export function onGuardCount(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function signatureOf(error) {
  const name = error && typeof error.name === "string" && error.name ? error.name : "Error";
  const stack = error && typeof error.stack === "string" ? error.stack : "";
  let frame = "";
  for (const line of stack.split("\n")) {
    const text = line.trim();
    if (text.startsWith("at ") || text.includes("@")) {
      frame = text;
      break;
    }
  }
  return `${name}|${frame}`;
}

function countOf(hits, sig) {
  let n = 0;
  for (const hit of hits) if (hit.sig === sig) n += 1;
  return n;
}

export function guardCallback(name, fn, opts = {}) {
  if (typeof fn !== "function") return fn;
  const clock = typeof opts.now === "function" ? opts.now : () => Date.now();
  const log = typeof opts.log === "function" ? opts.log : (...args) => console.error(...args);
  const hits = [];
  let silenced = false;
  let silencedUntil = 0;

  return function guarded(...args) {
    const t = clock();
    if (silenced) {
      if (t < silencedUntil) return undefined;
      silenced = false;
    }
    try {
      return fn.apply(this, args);
    } catch (error) {
      const cutoff = t - WINDOW_MS;
      let drop = 0;
      while (drop < hits.length && hits[drop].at <= cutoff) drop += 1;
      if (drop) hits.splice(0, drop);
      const sig = signatureOf(error);
      hits.push({ sig, at: t });
      const stats = opts.stats && typeof opts.stats === "object" ? opts.stats : sharedStats;
      if (stats) stats.errors = (Number(stats.errors) || 0) + 1;
      if (!loggedSignatures.has(sig)) {
        loggedSignatures.add(sig);
        try { log("[plexus-diagram]", name, error); }
        catch { /* a broken logger does not escape the guard */ }
      }
      if (countOf(hits, sig) >= TRIP) {
        silenced = true;
        silencedUntil = t + WINDOW_MS;
      }
      for (const listen of listeners) {
        try { listen(stats); }
        catch { /* the settings row must not rethrow into a timer */ }
      }
      return undefined;
    }
  };
}
