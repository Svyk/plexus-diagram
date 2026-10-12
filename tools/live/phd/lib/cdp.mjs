// One CDP connection to the Readwisenotes Roam window (Roam Desktop, 127.0.0.1:9223). Finds the page target whose
// title starts with "Readwisenotes" (its id changes when the window reopens) and refuses anything else.
export const PORT = Number(process.env.CDP_PORT || 9223);
export const GRAPH = "Readwisenotes";

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await res.json()).filter((t) => t.type === "page");
}

export async function findTarget(prefix = GRAPH) {
  const list = await targets();
  const hit = list.find((t) => (t.title || "").startsWith(prefix));
  if (!hit) throw new Error(`no Roam window titled ${prefix}…: ${list.map((t) => t.title).join(" | ")}`);
  return hit;
}

export class Cdp {
  constructor({ prefix = GRAPH, log = () => {} } = {}) {
    this.prefix = prefix;
    this.log = log;
    this.ws = null;
    this.next = 1;
    this.pending = new Map();
  }

  async connect() {
    const t = await findTarget(this.prefix);
    this.targetId = t.id;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = (e) => reject(new Error(`cdp connect: ${e.message || e.type}`));
      ws.onclose = () => {
        this.ws = null;
        for (const p of this.pending.values()) p.reject(new Error("cdp closed"));
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      };
    });
    // Belt and braces: the page we attached to must really be this graph.
    const graph = await this.evalRaw("window.roamAlphaAPI?.graph?.name || ''");
    if (graph !== GRAPH) throw new Error(`attached window is graph "${graph}", not ${GRAPH}`);
    this.log(`cdp: attached ${t.id.slice(0, 8)} "${t.title}"`);
  }

  rpc(method, params, timeoutMs = 600000) {
    if (!this.ws) return Promise.reject(new Error("cdp not connected"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`cdp timeout ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalRaw(expression, timeoutMs) {
    const r = await this.rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs || 600000 }, (timeoutMs || 600000) + 5000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text || JSON.stringify(r.exceptionDetails);
      throw new Error(`page: ${String(d).slice(0, 2000)}`);
    }
    return r.result?.value;
  }

  // Runs `(fn)(arg)` in the page (fn is a function or its source). Reconnects once if the window was reopened.
  async call(fn, arg, timeoutMs) {
    const src = typeof fn === "function" ? fn.toString() : fn;
    const expr = `(${src})(${JSON.stringify(arg ?? null)})`;
    try {
      if (!this.ws) await this.connect();
      return await this.evalRaw(expr, timeoutMs);
    } catch (e) {
      if (!/cdp (closed|not connected)|Cannot find context|Execution context was destroyed|Inspected target navigated/.test(e.message)) throw e;
      this.log(`cdp: ${e.message}; reconnecting`);
      await new Promise((r) => setTimeout(r, 2000));
      await this.connect();
      return this.evalRaw(expr, timeoutMs);
    }
  }

  close() { try { this.ws?.close(); } catch { /* closed */ } }
}
