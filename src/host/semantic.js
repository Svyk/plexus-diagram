// Roam's semantic search engine (roamAlphaAPI.data.async.semanticSearch). Only {'search-str'} is
// documented. Results are cached per query for 5 minutes (50 queries); a stale entry is returned at
// once and revalidated in the background. A missing or disabled API is never an error.

export const SEM_TTL_MS = 5 * 60 * 1000;
export const SEM_MAX = 50;
// A search that threw is asked again after this long; the rows it had (if any) stay meanwhile.
export const SEM_RETRY_MS = 30 * 1000;

export function semanticEnabled(api) {
  try {
    return api?.data?.semanticSearchEnabled?.() === true && typeof api?.data?.async?.semanticSearch === "function";
  } catch {
    return false;
  }
}

export function createSemantic({ api = () => globalThis.roamAlphaAPI, now = () => Date.now(), ttl = SEM_TTL_MS, max = SEM_MAX, retry = SEM_RETRY_MS } = {}) {
  const cache = new Map();
  const inflight = new Map();
  let calls = 0;

  const remember = (key, data, life = ttl) => {
    cache.delete(key);
    cache.set(key, { at: now(), data, life });
    while (cache.size > max) cache.delete(cache.keys().next().value);
  };
  const lifeOf = (hit) => (Number.isFinite(hit?.life) ? hit.life : ttl);

  const fetchFresh = (key) => {
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const a = api();
      if (!semanticEnabled(a)) return [];
      calls += 1;
      let raw = [];
      try {
        raw = await a.data.async.semanticSearch({ "search-str": key });
      } catch {
        // Keep the rows we had (or none) and ask again soon; a failure is not an answer worth 5 minutes.
        const had = cache.get(key)?.data || [];
        remember(key, had, retry);
        return had;
      }
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
      return hit ? { data: hit.data, stale: now() - hit.at >= lifeOf(hit) } : null;
    },
    // Fresh cache → it. Stale → it at once, then `onFresh(data)` after the background refresh. None → the engine.
    async search(query, { onFresh } = {}) {
      const key = String(query ?? "").trim();
      if (!key) return [];
      const hit = cache.get(key);
      if (hit && now() - hit.at < lifeOf(hit)) {
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
