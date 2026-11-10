// CDP helper for the stress tools. Roam Desktop windows share one port; the role of a Conn decides what it may send.
//   "passive": recorder only (observers, reads). Input, navigation, Fetch, Emulation and tracing are refused.
//   "bench":   the marked bench window only (guards below).
export const PORT = Number(process.env.CDP_PORT || 9223);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listPages() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  if (!res.ok) throw new Error(`cdp /json ${res.status}`);
  return (await res.json()).filter((t) => t.type === "page");
}

const PASSIVE_DENY = /^(Input\.|Page\.reload|Page\.navigate|Fetch\.|Emulation\.|Tracing\.)/;

export async function attach(target, role = "raw") {
  if (!target || !target.webSocketDebuggerUrl) throw new Error("attach: target has no webSocketDebuggerUrl (another debugger may hold it)");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp socket error for " + String(target.id).slice(0, 8))); });
  let id = 0;
  let closed = false;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    let d;
    try { d = JSON.parse(m.data); } catch { return; }
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); p.res(d); }
    else if (d.method) for (const f of listeners.slice()) { try { f(d); } catch { /* a listener must not break the socket */ } }
  };
  ws.onclose = (e) => {
    closed = true;
    for (const p of pending.values()) p.rej(new Error(`cdp closed ${e.code}`));
    pending.clear();
  };
  const conn = {
    id: target.id,
    title: target.title || "",
    role,
    get closed() { return closed; },
    send(method, params = {}) {
      if (conn.role === "passive" && PASSIVE_DENY.test(method)) return Promise.reject(new Error(`passive connection may not send ${method}`));
      if (closed) return Promise.reject(new Error("cdp closed"));
      return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    },
    async ev(expression, { timeout = 120000, awaitPromise = true } = {}) {
      const r = await conn.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, timeout });
      if (r.error) throw new Error(String(r.error.message || JSON.stringify(r.error)).slice(0, 800));
      const x = r.result;
      if (x && x.exceptionDetails) {
        const d = x.exceptionDetails;
        throw new Error(String((d.exception && (d.exception.description || d.exception.value)) || d.text || JSON.stringify(d)).slice(0, 800));
      }
      return x && x.result ? x.result.value : undefined;
    },
    async evJson(expression, opts) { return JSON.parse(await conn.ev(expression, opts)); },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
  return conn;
}

export async function connectPassive(idPrefix) {
  if (!idPrefix) throw new Error("connectPassive: target id prefix required");
  const pages = await listPages();
  const t = pages.find((p) => p.id.startsWith(idPrefix));
  if (!t) throw new Error(`no page with id prefix ${idPrefix}: ` + pages.map((p) => p.id.slice(0, 8) + " " + p.title).join(" | "));
  if (/^Svy/.test(t.title || "")) {
    // the Svy window is never touched: not even a read.
    throw new Error(`refusing the Svy window: ${t.title}`);
  }
  return attach(t, "passive");
}

const MARK = `sessionStorage["pxd-bench"] || ""`;

export async function findBench(opts = {}) {
  const want = opts.target || process.env.STRESS_TARGET;
  const pages = await listPages();
  if (want) {
    const t = pages.find((p) => p.id.startsWith(want));
    if (!t) throw new Error(`no page with id prefix ${want}: ` + pages.map((p) => p.id.slice(0, 8) + " " + p.title).join(" | "));
    return t;
  }
  const cands = pages.filter((p) => /^Readwisenotes/.test(p.title || ""));
  const marked = [];
  for (const p of cands) {
    let c;
    try { c = await attach(p, "probe"); if ((await c.ev(MARK, { timeout: 5000 })) === "1") marked.push(p); }
    catch { /* a window that cannot be read is not the bench */ }
    finally { if (c) c.close(); }
  }
  if (marked.length === 1) return marked[0];
  const list = (a) => a.map((p) => p.id.slice(0, 8) + " " + p.title).join(" | ") || "(none)";
  if (!marked.length) throw new Error(`no bench window: open a second Readwisenotes window and mark it with sessionStorage["pxd-bench"]="1". Readwisenotes windows: ${list(cands)}`);
  throw new Error(`several bench windows marked, pass opts.target or STRESS_TARGET (id prefix): ${list(marked)}`);
}

export async function connectBench(opts = {}) {
  const t = await findBench(opts);
  const c = await attach(t, "bench");
  try {
    if (!/^Readwisenotes/.test(c.title)) throw new Error(`not a Readwisenotes window: ${c.title}`);
    if (/plx typing bench/.test(c.title)) throw new Error(`refusing the typing bench window: ${c.title}`);
    if ((await c.ev(MARK, { timeout: 10000 })) !== "1") throw new Error(`window ${c.id.slice(0, 8)} is not marked as bench: set sessionStorage["pxd-bench"]="1" in it`);
    if ((await c.ev(`typeof window.__pxdRec`, { timeout: 10000 })) !== "undefined") throw new Error(`window ${c.id.slice(0, 8)} runs the passive recorder (window.__pxdRec): it is Svy's window, not the bench`);
    // the bench window is usually not the focused OS window
    await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch (e) { c.close(); throw e; }
  return c;
}
