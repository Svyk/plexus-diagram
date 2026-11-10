// Script naming and owner attribution. A blob: URL has no name of its own, so we read the source head.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HINTS = ["roam-grid", "zoteroRoam", "better-tasks", "bettertasks", "live-ai", "liveai", "workbench", "roamjs", "smartblocks", "reference-path", "task-status", "plexus", "cursor-smith", "readwise", "blueprint", "chief-of-staff", "nautilus", "tldraw", "excalidraw", "mermaid", "pdf"];

// returns {url: {name, len}} for the wanted URLs
export async function nameScripts(c, urls) {
  const want = new Set([...(urls || [])].filter(Boolean));
  if (!want.size) return {};
  const scripts = new Map();
  const off = c.on((m) => { if (m.method === "Debugger.scriptParsed" && want.has(m.params.url)) scripts.set(m.params.url, { id: m.params.scriptId, len: m.params.length }); });
  const names = {};
  try {
    await c.send("Debugger.enable");
    await sleep(2500);
    for (const [url, sc] of scripts) {
      const got = await Promise.race([c.send("Debugger.getScriptSource", { scriptId: sc.id }), sleep(6000).then(() => ({}))]);
      const src = got?.result?.scriptSource || "";
      let name = null;
      if (src.includes("__plexusDiagram") && src.includes("pxd-root")) name = "plexus-diagram";
      else {
        const m = src.slice(0, 400).match(/\/\*!?\s*([A-Za-z][\w .@/-]{2,60}?)\s+v?(\d+\.\d+[\w.-]*)/) || src.slice(0, 4000).match(/name:\s*["']([\w .-]{3,40})["']/);
        name = m ? m[1].trim() : null;
      }
      if (!name) { const low = src.slice(0, 200000).toLowerCase(); name = HINTS.find((h) => low.includes(h.toLowerCase())) || null; }
      names[url] = { name: name || "?", len: sc.len };
    }
  } finally {
    off();
    try { await c.send("Debugger.disable"); } catch {}
  }
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
