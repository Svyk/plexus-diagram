// A loopback file server for the PDFs the page uploads. files: { name: path | { path, append?, type? } }. 127.0.0.1 only, random port, a per-run token,
// CORS + private-network headers so the https Roam window may fetch from it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export async function serveFiles(files) {
  const token = randomBytes(12).toString("hex");
  const map = new Map(Object.entries(files));
  const server = createServer(async (req, res) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, headers); res.end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    const entry = map.get(decodeURIComponent(url.pathname.slice(1)));
    const path = typeof entry === "string" ? entry : entry?.path;
    if (url.searchParams.get("t") !== token || !path) { res.writeHead(404, headers); res.end(); return; }
    try {
      let body = await readFile(path);
      // A trailing PDF comment after %%EOF: same document, different bytes, so Roam never matches it (by
      // :pdf/content-hash) to a page the user already highlighted from the same file.
      if (entry?.append) body = Buffer.concat([body, Buffer.from(entry.append)]);
      res.writeHead(200, { ...headers, "Content-Type": entry?.type || "application/pdf", "Content-Length": body.length });
      res.end(body);
    } catch {
      res.writeHead(500, headers); res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: (name) => `http://127.0.0.1:${port}/${encodeURIComponent(name)}?t=${token}`,
    add: (name, entry) => map.set(name, entry),
    close: () => new Promise((r) => server.close(r)),
  };
}
