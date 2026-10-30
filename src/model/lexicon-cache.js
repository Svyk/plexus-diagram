import { CACHE_NAME, LEXICON_FILE, PAGES_ORIGIN } from "./ocr/manifest.js";

// True when Cache Storage already holds the title word list. Reads nothing else; never fetches.
export async function hasCachedLexicon({ cachesImpl = globalThis.caches, assetBase = PAGES_ORIGIN } = {}) {
  if (!cachesImpl || typeof cachesImpl.open !== "function") return false;
  try {
    const cache = await cachesImpl.open(CACHE_NAME);
    return Boolean(await cache.match(`${assetBase.replace(/\/+$/, "")}/assets/ocr/${LEXICON_FILE.file}`));
  } catch { return false; }
}
