// Script naming and owner attribution. A blob: URL has no name of its own, so we read the source head.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HINTS = ["roam-grid", "zoteroRoam", "better-tasks", "bettertasks", "live-ai", "liveai", "workbench", "roamjs", "smartblocks", "reference-path", "task-status", "plexus", "cursor-smith", "readwise", "blueprint", "chief-of-staff", "nautilus", "tldraw", "excalidraw", "mermaid", "pdf"];

export const isBig = (len) => !(len < 300000);

// Naming happens without moving script sources over CDP: a multi-MB reply drops the socket.
// returns {url: {name, len}} for blob: URLs only
export async function nameScripts(c, urls) {
  const want = [...new Set([...(urls || [])].filter((u) => typeof u === "string" && u.startsWith("blob:")))];
  if (!want.length) return {};
  const byId = new Map(), byUrl = new Map();
  const off = c.on((m) => { if (m.method === "Debugger.scriptParsed" && m.params.url) { byId.set(m.params.scriptId, { url: m.params.url, length: m.params.length }); byUrl.set(m.params.url, { scriptId: m.params.scriptId, length: m.params.length }); } });
  const names = {};
  const lenOf = (u) => (byUrl.get(u) || {}).length;
  try {
    await c.send("Debugger.enable");
    await sleep(1500);
    // Plexus: the scriptId of a function it registered, no source read
    try {
      const r = await c.send("Runtime.evaluate", { expression: "window.__plexusDiagram && window.__plexusDiagram.views", returnByValue: false });
      const oid = r && r.result && r.result.result && r.result.result.objectId;
      if (oid) {
        try {
          const p = await c.send("Runtime.getProperties", { objectId: oid, ownProperties: false, accessorPropertiesOnly: false, generatePreview: false });
          const fl = ((p && p.result && p.result.internalProperties) || []).find((x) => x.name === "[[FunctionLocation]]");
          const sid = fl && fl.value && fl.value.value && fl.value.value.scriptId;
          const u = sid && byId.get(String(sid)) && byId.get(String(sid)).url;
          if (u && want.includes(u)) names[u] = { name: "plexus-diagram", len: lenOf(u) };
        } finally { try { await c.send("Runtime.releaseObject", { objectId: oid }); } catch {} }
      }
    } catch {}
    // everything else: name it inside the page, only short strings come back
    const rest = want.filter((u) => !names[u]);
    if (rest.length) {
      const expr = `(async () => {
        const urls = ${JSON.stringify(rest)}, hints = ${JSON.stringify(HINTS)}, out = {};
        const to = (ms) => new Promise((r) => setTimeout(() => r(null), ms));
        for (const url of urls) {
          let text = null;
          try { text = await Promise.race([fetch(url).then((r) => r.blob()).then((b) => b.slice(0, 200000).text()), to(4000)]); } catch (e) {}
          if (text == null) continue;
          let name = null;
          if (text.includes("__plexusDiagram") && text.includes("pxd-root")) name = "plexus-diagram";
          else { const m = text.slice(0, 400).match(/\\/\\*!?\\s*([A-Za-z][\\w .@/-]{2,60}?)\\s+v?(\\d+\\.\\d+[\\w.-]*)/) || text.slice(0, 4000).match(/name:\\s*["']([\\w .-]{3,40})["']/); name = m ? m[1].trim() : null; }
          if (!name) { const low = text.toLowerCase(); name = hints.find((h) => low.includes(h.toLowerCase())) || null; }
          out[url] = { name, head: text.slice(0, 100).replace(/\\s+/g, " ") };
        }
        return JSON.stringify(out);
      })()`;
      try {
        const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
        const got = JSON.parse((r && r.result && r.result.result && r.result.result.value) || "{}");
        for (const [u, g] of Object.entries(got)) if (g.name) names[u] = { name: g.name, len: lenOf(u) };
      } catch {}
    }
    // last resort, small scripts only
    for (const u of want) {
      if (names[u]) continue;
      const sc = byUrl.get(u);
      if (!sc || isBig(sc.length)) continue;
      try {
        const got = await Promise.race([c.send("Debugger.getScriptSource", { scriptId: sc.scriptId }), sleep(6000).then(() => ({}))]);
        const src = (got && got.result && got.result.scriptSource) || "";
        let name = null;
        if (src.includes("__plexusDiagram") && src.includes("pxd-root")) name = "plexus-diagram";
        else { const m = src.slice(0, 400).match(/\/\*!?\s*([A-Za-z][\w .@/-]{2,60}?)\s+v?(\d+\.\d+[\w.-]*)/) || src.slice(0, 4000).match(/name:\s*["']([\w .-]{3,40})["']/); name = m ? m[1].trim() : null; }
        if (!name) { const low = src.toLowerCase(); name = HINTS.find((h) => low.includes(h.toLowerCase())) || null; }
        if (name) names[u] = { name, len: sc.length };
      } catch {}
    }
  } finally {
    off();
    try { await c.send("Debugger.disable"); } catch {}
  }
  for (const u of want) if (!names[u]) names[u] = { name: "ext:" + u.slice(-6), len: lenOf(u) };
  return names;
}

export function ownerOf(url, names) {
  if (!url) return "(unknown)";
  if (url.startsWith("blob:")) {
    const n = names && names[url] && names[url].name;
    if (n === "plexus-diagram") return "plexus";
    return n && n !== "?" ? n : "ext:" + url.slice(-6);
  }
  if (url.includes("roamresearch.com")) return "roam";
  try { return new URL(url).host || "(unknown)"; } catch { return "(unknown)"; }
}

export function attributeStalls(summary, names) {
  const per = {}, forced = {};
  let render = 0, unattributed = 0;
  for (const s of summary?.stalls?.list || []) {
    let sd = 0;
    for (const sc of s.scripts || []) {
      const o = ownerOf(sc.u, names);
      const f = sc.f || 0;
      per[o] = (per[o] || 0) + (sc.d - f);
      forced[o] = (forced[o] || 0) + f;
      sd += sc.d;
    }
    render += s.sl || 0;
    unattributed += Math.max(0, s.d - sd - (s.sl || 0));
  }
  const r = (x) => Math.round(x);
  const other = {};
  for (const [k, v] of Object.entries(per)) if (k !== "plexus" && k !== "roam") other[k] = r(v);
  const fo = {};
  for (const [k, v] of Object.entries(forced)) if (v) fo[k] = r(v);
  summary.owner = { plexus: r(per.plexus || 0), roam: r(per.roam || 0), other, forced: fo, render: r(render), unattributed: r(unattributed) };
  return summary.owner;
}
