// Chrome tracing over CDP: start with the categories the analyser needs, stream the gzip result to a file.
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function startTrace(c, { cpu = true, selectors = false } = {}) {
  const includedCategories = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "v8", "blink.user_timing", "loading", "latencyInfo"];
  if (cpu) includedCategories.push("disabled-by-default-v8.cpu_profiler");
  if (selectors) includedCategories.push("disabled-by-default-blink.debug");
  const r = await c.send("Tracing.start", { transferMode: "ReturnAsStream", streamFormat: "json", streamCompression: "gzip", traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories } });
  if (r && r.error) throw new Error("Tracing.start failed: " + (r.error.message || JSON.stringify(r.error)));
  // the analyser finds this page's main thread from this mark
  await c.ev(`(performance.mark("pxd-stress-trace"), 1)`);
}

export async function stopTrace(c, file) {
  let off = () => {};
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tracing.tracingComplete timeout (120 s)")), 120000);
    off = c.on((m) => { if (m.method === "Tracing.tracingComplete") { clearTimeout(timer); resolve(m.params); } });
  });
  done.catch(() => {});
  const end = await c.send("Tracing.end");
  if (end && end.error) { off(); throw new Error("Tracing.end failed: " + (end.error.message || JSON.stringify(end.error))); }
  let params;
  try { params = await done; } finally { off(); }
  const handle = params && params.stream;
  if (!handle) throw new Error("trace finished without a stream handle");
  await mkdir(dirname(file), { recursive: true });
  const out = createWriteStream(file);
  const finished = new Promise((res, rej) => { out.on("finish", res); out.on("error", rej); });
  let bytes = 0;
  try {
    for (;;) {
      const r = await c.send("IO.read", { handle, size: 1 << 20 });
      if (r.error) throw new Error("IO.read failed: " + (r.error.message || JSON.stringify(r.error)));
      const { data, base64Encoded, eof } = r.result;
      const buf = base64Encoded ? Buffer.from(data, "base64") : Buffer.from(data, "utf8");
      bytes += buf.length;
      if (!out.write(buf)) await new Promise((res) => out.once("drain", res));
      if (eof) break;
    }
  } finally {
    out.end();
    await finished.catch(() => {});
    try { await c.send("IO.close", { handle }); } catch {}
  }
  return { file, bytes };
}
