// Roam's semantic search engine (roamAlphaAPI.data.async.semanticSearch). Only {'search-str'} is
// documented. Results are cached per query for 5 minutes (50 queries); a stale entry is returned at
// once and revalidated in the background. A missing or disabled API is never an error.

export const SEM_TTL_MS = 5 * 60 * 1000;
export const SEM_MAX = 50;

export function semanticEnabled(api) {
  try {
    return api?.data?.semanticSearchEnabled?.() === true && typeof api?.data?.async?.semanticSearch === "function";
  } catch {
    return false;
  }
}

export function createSemantic({ api = () => globalThis.roamAlphaAPI, now = () => Date.now(), ttl = SEM_TTL_MS, max = SEM_MAX } = {}) {
  const cache = new Map();
  const inflight = new Map();
  let calls = 0;

  const remember = (key, data) => {
    cache.delete(key);
    cache.set(key, { at: now(), data });
    while (cache.size > max) cache.delete(cache.keys().next().value);
  };

  const fetchFresh = (key) => {
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const a = api();
      if (!semanticEnabled(a)) return [];
      calls += 1;
      let raw = [];
      try { raw = await a.data.async.semanticSearch({ "search-str": key }); } catch { raw = []; }
      const data = Array.isArray(raw) ? raw : [];
      remember(key, data);
      return data;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };

  return {
    enabled: () => semanticEnabled(api()),
    // { data, stale } when cached, else null. Never calls the engine.
    peek(query) {
      const key = String(query ?? "").trim();
      const hit = key ? cache.get(key) : null;
      return hit ? { data: hit.data, stale: now() - hit.at >= ttl } : null;
    },
    // Fresh cache → it. Stale → it at once, then `onFresh(data)` after the background refresh. None → the engine.
    async search(query, { onFresh } = {}) {
      const key = String(query ?? "").trim();
      if (!key) return [];
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) {
        cache.delete(key);
        cache.set(key, hit);
        return hit.data;
      }
      if (hit) {
        fetchFresh(key).then((data) => { try { onFresh?.(data); } catch { /* caller */ } }, () => {});
        return hit.data;
      }
      return fetchFresh(key);
    },
    clear: () => cache.clear(),
    report: () => ({ calls, cached: cache.size, inflight: inflight.size }),
  };
}
