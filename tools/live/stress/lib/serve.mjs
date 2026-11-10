// Serve a local Plexus build into the bench window through Fetch interception (the Depot URL stays the same).
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const MATCH = /plexus-diagram\/(extension\.(js|css))(\?|$)/;

export async function serveBuild(c, dir) {
  const out = { dir: dir || null, sha: null, bytes: 0, chars: 0, served: { js: 0, css: 0 }, stop: async () => {} };
  if (!dir || dir === "installed") return out;
  const js = await readFile(join(dir, "extension.js"));
  out.sha = createHash("sha256").update(js).digest("hex").slice(0, 12);
  out.bytes = js.length;
  out.chars = js.toString("utf8").length;
  const off = c.on(async (m) => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      const hit = MATCH.exec(request.url);
      if (!hit) { await c.send("Fetch.continueRequest", { requestId }); return; }
      const kind = hit[2];
      const body = await readFile(join(dir, `extension.${kind}`)); // re-read each time
      out.served[kind]++;
      await c.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: kind === "js" ? "text/javascript" : "text/css" },
          { name: "Access-Control-Allow-Origin", value: "*" }, // without it the extension silently fails to load
          { name: "Cache-Control", value: "no-store" },
        ],
        body: body.toString("base64"),
      });
    } catch (e) {
      try { await c.send("Fetch.continueRequest", { requestId }); } catch { /* socket gone */ }
    }
  });
  await c.send("Fetch.enable", { patterns: [{ urlPattern: "*plexus-diagram*", requestStage: "Request" }] });
  out.stop = async () => { off(); if (!c.closed) await c.send("Fetch.disable"); };
  return out;
}
