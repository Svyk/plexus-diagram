// Pure parser for what a drop carries. No DOM: the view passes the DataTransfer-like object.
// Sources it understands: our own panel rows (CARD_MIME), Roam bullet drags (roam/block-uid-list*),
// Roam / browser URLs (`.../#/app/<graph>/page/<uid>`, in roam/roam-uri-list, text/uri-list or text/plain),
// anchors that carry data-link-uid / data-link-title, and text: [[Title]], #Tag, ((uid)), a bare 9-char uid.
// A page uid resolves to [[Title]] and a block uid to ((uid)) through the injected resolveUid.

export const CARD_MIME = "application/x-plexus-card";
const MAX_DROP = 50;
const URL_LINE = /^(?:https?|roam):\/\//i;
const APP_URL = /#\/app\/([^/?#]+)(?:\/page\/([\w-]+))?/;

export function parseDropPayload(dataTransfer, { resolveUid, graph = "" } = {}) {
  if (!dataTransfer) return [];
  const take = (type) => {
    try { return String(dataTransfer.getData?.(type) || ""); } catch { return ""; }
  };
  const resolve = typeof resolveUid === "function" ? resolveUid : (uid) => `((${uid}))`;
  const own = take(CARD_MIME).trim();
  if (own) return [{ string: own }];
  const tokens = (text) => text.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list", "text/plain"]) {
      for (const raw of take(type).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (type === "text/plain" && !URL_LINE.test(line)) continue;
        const app = APP_URL.exec(line);
        if (app && graph && decodeURIComponent(app[1]) !== graph) continue;
        const m = app ? (app[2] ? [null, app[2]] : null) : line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
  }
  if (!uids.length) {
    for (const m of take("text/html").matchAll(/data-link-uid="([\w-]+)"/g)) uids.push(m[1]);
  }
  if (uids.length) {
    const out = [];
    for (const uid of [...new Set(uids)].slice(0, MAX_DROP)) {
      let string = null;
      try { string = resolve(uid); } catch { string = null; }
      if (typeof string === "string" && string.trim()) out.push({ string });
    }
    if (out.length) return out;
  }
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return [];
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return [{ string: `[[${page[1]}]]` }];
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return [{ string: `((${blockRef[1]}))` }];
  const linked = take("text/html").match(/data-link-title="([^"]+)"/);
  if (linked) return [{ string: `[[${linked[1].replace(/&amp;/g, "&").replace(/&quot;/g, "\"")}]]` }];
  const plain = take("text/plain").trim();
  const tag = /^#([^\s#[\]/][^\s#[\]]*)$/.exec(plain);
  if (tag) return [{ string: `[[${tag[1]}]]` }];
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    let string = null;
    try { string = resolve(plain); } catch { string = null; }
    if (typeof string === "string" && string.trim()) return [{ string }];
  }
  return [];
}
