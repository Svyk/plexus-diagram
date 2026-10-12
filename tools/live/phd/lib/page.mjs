// Functions that run inside the Readwisenotes window (sent over CDP with Cdp.call). Each is self-contained:
// no closures over Node values, only its JSON argument.

// Which of these uids exist (blocks or pages)? Chunks of 400 through pull_many (one flat ~5 ms call per 50).
export function existing(uids) {
  const a = window.roamAlphaAPI;
  const out = [];
  for (let i = 0; i < uids.length; i += 400) {
    const chunk = uids.slice(i, i + 400);
    const rows = a.data.pull_many("[:block/uid]", chunk.map((u) => [":block/uid", u])) || [];
    for (const r of rows) if (r && r[":block/uid"]) out.push(r[":block/uid"]);
  }
  return out;
}

export function pagesByTitle(titles) {
  const a = window.roamAlphaAPI;
  const rows = a.data.pull_many("[:block/uid :node/title]", titles.map((t) => [":node/title", t])) || [];
  const out = {};
  for (const r of rows) if (r && r[":node/title"]) out[r[":node/title"]] = r[":block/uid"];
  return out;
}

// Create blocks/pages. ops: [{ kind, uid, parent, title, string, props, open }]. Siblings of one parent are written
// one after another with order "last"; different parents run `conc` at a time. Reports the longest main-thread gap
// seen by a 50 ms timer during the batch (a frozen Roam shows up as a big gap).
export async function writeOps({ ops, conc = 8 }) {
  const a = window.roamAlphaAPI;
  const t0 = performance.now();
  let maxGap = 0;
  let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last - 50); last = now; }, 50);
  const groups = new Map();
  for (const op of ops) {
    const k = op.kind === "page" ? `page:${op.uid}` : op.parent;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(op);
  }
  const queue = [...groups.values()];
  const failed = [];
  let done = 0;
  const one = async (op) => {
    if (op.kind === "page") {
      await a.data.page.create({ page: { title: op.title, uid: op.uid } });
      return;
    }
    const block = { uid: op.uid, string: op.string ?? "" };
    if (op.props && Object.keys(op.props).length) block.props = op.props;
    if (op.open !== undefined && op.open !== null) block.open = op.open;
    await a.data.block.create({ location: { "parent-uid": op.parent, order: "last" }, block });
  };
  const worker = async () => {
    for (;;) {
      const list = queue.shift();
      if (!list) return;
      for (const op of list) {
        try { await one(op); done += 1; } catch (e) { failed.push({ uid: op.uid, key: op.key, err: String(e?.message || e).slice(0, 200) }); }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));
  clearInterval(timer);
  return { done, failed, ms: Math.round(performance.now() - t0), maxGap: Math.round(maxGap) };
}

export async function updateBlocks({ list }) {
  const a = window.roamAlphaAPI;
  const failed = [];
  for (const u of list) {
    try {
      const block = { uid: u.uid };
      if (u.string !== undefined) block.string = u.string;
      if (u.props !== undefined) block.props = u.props;
      if (u.open !== undefined) block.open = u.open;
      await a.data.block.update({ block });
    } catch (e) { failed.push({ uid: u.uid, err: String(e?.message || e) }); }
  }
  return { failed };
}

export async function goDaily() {
  await window.roamAlphaAPI.ui.mainWindow.openDailyNotes();
  return location.hash;
}

export function sidebarCount() {
  return window.roamAlphaAPI.ui.rightSidebar.getWindows().length;
}

// Fetch a file from the loopback server and upload it to Roam. Returns the bare firebase URL.
export async function uploadFrom({ src, name, type = "application/pdf" }) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], name, { type });
  const raw = await window.roamAlphaAPI.file.upload({ file });
  const s = typeof raw === "string" ? raw : raw?.url || "";
  const md = /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(s);
  const hit = /https?:\/\/[^\s)}\]"']+/.exec(s);
  const url = md ? md[1] : hit ? hit[0] : "";
  if (!url) throw new Error(`upload returned ${s.slice(0, 120)}`);
  return { url, bytes: blob.size };
}

// Render a crop of a PDF page with Roam's own pdf.js, upload it as PNG. crop = [x,y,w,h] fractions of the page.
export async function cropUpload({ pdfUrl, page, crop, name, scale = 2 }) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdfjsLib missing");
  if (!lib.GlobalWorkerOptions.workerSrc && !lib.GlobalWorkerOptions.workerPort) throw new Error("pdfjsLib has no worker yet");
  const doc = await lib.getDocument({ url: pdfUrl }).promise;
  try {
    const p = await doc.getPage(Math.min(Math.max(1, page || 1), doc.numPages));
    const vp = p.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await p.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const [fx, fy, fw, fh] = Array.isArray(crop) && crop.length === 4 ? crop : [0, 0, 1, 1];
    const out = document.createElement("canvas");
    out.width = Math.max(8, Math.round(canvas.width * fw));
    out.height = Math.max(8, Math.round(canvas.height * fh));
    out.getContext("2d").drawImage(canvas, Math.round(canvas.width * fx), Math.round(canvas.height * fy), out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const raw = await window.roamAlphaAPI.file.upload({ file: new File([blob], name, { type: "image/png" }) });
    const s = typeof raw === "string" ? raw : raw?.url || "";
    const md = /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(s);
    const hit = /https?:\/\/[^\s)}\]"']+/.exec(s);
    const url = md ? md[1] : hit ? hit[0] : "";
    if (!url) throw new Error(`upload returned ${s.slice(0, 120)}`);
    return { url, w: out.width, h: out.height };
  } finally {
    doc.destroy();
  }
}

// Mount the PDF block in the main window and wait for Roam's reader (react-pdf-highlighter) to have the document.
export async function readerOpen({ pdfUid, waitMs = 60000 }) {
  const a = window.roamAlphaAPI;
  await a.ui.mainWindow.openBlock({ block: { uid: pdfUid } });
  const t0 = performance.now();
  for (;;) {
    const el = document.querySelector(".PdfHighlighter");
    if (el) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
      let f = el[key];
      for (let d = 0; f && d < 6; d += 1, f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p.onSelection === "function" && p.pdfDocument) return { ok: true, pages: p.pdfDocument.numPages, ms: Math.round(performance.now() - t0) };
      }
    }
    if (performance.now() - t0 > waitMs) return { ok: false, reason: "reader did not mount" };
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Make Roam highlights through the reader's own onSelection (highlight mode on), so Roam writes the block, its
// :annotation/origin and (first time) the PDF page with :pdf/url and :pdf/content-hash. items: [{ key, text,
// position }]. Returns { made: { key: uid }, missed: [key], pageUid }.
export async function readerHighlight({ url, items, settleMs = 4000 }) {
  const a = window.roamAlphaAPI;
  const props = () => {
    const el = document.querySelector(".PdfHighlighter");
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    let f = el[key];
    for (let d = 0; f && d < 6; d += 1, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p.onSelection === "function") return p;
    }
    return null;
  };
  const known = () => {
    const rows = a.data.q("[:find ?u ?s :in $ ?url :where [?p :pdf/url ?url] [?b :annotation/origin ?p] [?b :block/uid ?u] [?b :block/string ?s]]", url) || [];
    return new Map(rows.map(([u, s]) => [u, s]));
  };
  const pageUid = () => a.data.q("[:find ?u . :in $ ?url :where [?p :pdf/url ?url] [?p :block/uid ?u]]", url) || "";
  let have = known();
  const made = {};
  const missed = [];
  let toggled = false;
  const select = (it) => {
    const p = props();
    if (!p) throw new Error("reader gone");
    const content = { text: it.text };
    const position = it.position;
    p.onSelection({ content, type: "text", position, makeGhostHighlight: () => ({ content, type: "text", position }) });
  };
  const waitNew = async (ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 40));
      const now = known();
      const fresh = [...now.keys()].filter((u) => !have.has(u));
      if (fresh.length) { have = now; return fresh; }
    }
    return [];
  };
  for (const it of items) {
    select(it);
    let fresh = await waitNew(settleMs);
    if (!fresh.length && !toggled) {
      // Highlight mode was off: the selection only made a ghost. Turn it on (toolbar highlight button) and retry once.
      toggled = true;
      const btn = document.querySelector(".bp3-icon-highlight")?.closest("button");
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 300));
      select(it);
      fresh = await waitNew(settleMs);
    }
    if (fresh.length) made[it.key] = fresh[0];
    else missed.push(it.key);
  }
  return { made, missed, pageUid: pageUid() };
}
