// One synchronous name for a PDF, from caches only: no read, no queue, no graph write. The board view registers
// the resolver; chips and rows ask by card uid or by file url. "" while nothing real is known yet.

let resolver = null;

export function setPdfNameResolver(fn) {
  resolver = typeof fn === "function" ? fn : null;
  return () => { if (resolver === fn) resolver = null; };
}

export function pdfNameFor(uidOrUrl) {
  const key = typeof uidOrUrl === "string" ? uidOrUrl.trim() : "";
  if (!key || !resolver) return "";
  try {
    const name = resolver(key);
    return typeof name === "string" && name && name !== "PDF" ? name : "";
  } catch {
    return "";
  }
}
