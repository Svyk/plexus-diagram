const sel = process.argv[2];
const res = await fetch("http://127.0.0.1:9223/json");
const t = (await res.json()).find((x) => x.type === "page" && (x.title || "").includes(sel));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const out = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    if (/plexus|pxd/i.test(e.text + (e.url || ""))) out.push(`[log ${e.level}] ${e.text.slice(0, 400)}`);
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (/plexus|pxd/i.test(text)) out.push(`[console ${m.params.type}] ${text.slice(0, 400)}`);
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    const text = (d.exception?.description || d.text || "") + " " + (d.url || "");
    if (/plexus|pxd|svyk/i.test(text)) out.push(`[exception] ${text.slice(0, 600)}`);
  }
};
ws.send(JSON.stringify({ id: 1, method: "Log.enable" }));
ws.send(JSON.stringify({ id: 2, method: "Runtime.enable" }));
await new Promise((r) => setTimeout(r, 2500));
console.log(out.slice(-40).join("\n") || "(no plexus log lines buffered)");
ws.close();
process.exit(0);
