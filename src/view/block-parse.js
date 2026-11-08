// "Plexus: Parse PDF" on a normal block. Mounted on document.body, outside .pxd-root, like the board picker.
// Nothing is written until the user clicks Parse; opening the dialog only reads.

import { flattenLine, toRoamMarkdown } from "../model/parse-to-roam-md.js";
import { toGridSpec } from "../model/parse-to-grid.js";
import { pageNoteBlocks, prepareTable } from "../model/footnotes.js";
import { parsedTableCaption, parsedTableSize } from "../model/roam-table.js";
import { highlightRows } from "../model/highlight-pick.js";
import { pdfFileTitle } from "../model/pdf.js";
import {
  containerString,
  highlightRefLines,
  parsedMarker,
  parsedOf,
  parsePageRange,
  pdfSourceOf,
  planBlockParse,
  scanNote,
} from "../model/block-parse.js";

const WINDOW_MS = 60000;
const WINDOW_LIMIT = 1200;

const ERRORS = {
  "no-pdfjs": "Roam's PDF reader is not loaded yet. Open the PDF once, then try again.",
  fetch: "Could not read the PDF.",
  "too-large": "This range is too large. Choose fewer pages.",
  empty: "No text found in these pages.",
  "write-failed": "Parse failed. Nothing was kept.",
};

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  const timer = globalThis.setTimeout(done, ms);
  function done() {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener?.("abort", done);
    resolve();
  }
  signal?.addEventListener?.("abort", done);
});

function bulletCount(markdown) {
  return (String(markdown ?? "").match(/^\s*- /gm) || []).length;
}

function nativeTableMarkdown(table) {
  const id = typeof table?.id === "string" && table.id ? table.id : "t1";
  const block = { ...table, id, type: table?.type || "table" };
  return toRoamMarkdown({ blocks: { [id]: block }, order: [id] }, [id]).markdown;
}

// The parsed child of a block, if an earlier run left one. Read only when the dialog opens.
export function findParsedKid(host, blockUid) {
  let kids = [];
  try { kids = host.outlineKids?.([blockUid])?.get(blockUid) || []; } catch { kids = []; }
  for (const kid of kids) {
    let props = null;
    try { props = host.pullProps?.(kid.uid); } catch { props = null; }
    const record = parsedOf(props);
    if (record) return { uid: kid.uid, order: kid.order, record };
  }
  return null;
}

function failedWith(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

async function writeTable(host, doc, container, step) {
  const prep = prepareTable(step.table, pageNoteBlocks(doc, step.table), { format: "plain" });
  const table = prep.table;
  const cap = host.generateUid();
  await host.createBlock({
    parentUid: container,
    order: "last",
    uid: cap,
    string: flattenLine(step.caption) || parsedTableCaption(step.table),
    open: true,
  });
  let made = false;
  if (host.canCreateGridTable?.()) {
    try {
      const spec = { ...toGridSpec(table), parentUid: cap, order: 0 };
      const size = parsedTableSize(table);
      if (size.widths) spec.widths = size.widths;
      const info = await host.createGridTable(spec);
      made = Boolean(info?.uid);
    } catch {
      made = false;
    }
  }
  if (!made) {
    const roots = await host.fromMarkdown({ parentUid: cap, order: 0, markdown: nativeTableMarkdown(table) });
    made = Array.isArray(roots) && roots.length > 0;
  }
  if (!made) await host.deleteBlock(cap);
}

// Reads the PDF, then writes the result under the block. DOM-free so the writes can be tested alone.
// Replacing deletes the old container last, after the new one is complete.
export async function runBlockParse({
  host,
  pdfTables,
  blockUid,
  source,
  range,
  highlights = null,
  existing = null,
  signal,
  fetchBytes,
  onProgress = () => {},
  now = () => Date.now(),
  sleep = defaultSleep,
}) {
  let read;
  const whole = !range || range.whole || range.to == null;
  const pages = whole ? null : Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i);
  try {
    read = await pdfTables.docFromPdf({
      url: source.url,
      pages,
      signal,
      fetchBytes,
      onPage: ({ phase, pages: scans, page, from, to }) => (phase === "ocr"
        ? onProgress({ phase: "ocr", total: scans?.length || 0 })
        : onProgress({ phase: "read", page, index: page - from + 1, total: to - from + 1 })),
    });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) return failedWith("aborted-read");
    if (error?.code === "no-pdfjs") return failedWith("no-pdfjs");
    return failedWith("fetch");
  }
  if (signal?.aborted) return failedWith("aborted-read");
  const doc = read.doc;
  const count = Number.isInteger(read.pageCount) ? read.pageCount : (doc.pageCount || null);
  const from = range?.from ?? 1;
  const to = range?.whole || range?.to == null ? (count ?? from) : range.to;
  const total = to - from + 1;
  const helperReady = read.ocr?.state === "ready";
  const left = (read.needsOcr || []).filter((n) => n >= from && n <= to);
  const note = scanNote(left, { helper: helperReady });
  const plan = planBlockParse(doc, { from, to });
  if (!plan.ok) return failedWith("too-large");
  if (left.length >= total) return failedWith("all-scans", { note });
  if (!plan.steps.length) return failedWith("empty");

  const limit = { start: now(), written: 0 };
  const container = host.generateUid();
  const refLines = highlights && highlights.length ? highlightRefLines(highlights, from, to) : "";
  const steps = plan.steps.length + (refLines ? 1 : 0);
  let blocks = 1;
  let created = false;
  // Waits when this step would push the minute past WINDOW_LIMIT (Roam allows 1500 writes a minute).
  const throttle = async (index, next) => {
    const t = now();
    if (t - limit.start >= WINDOW_MS) { limit.start = t; limit.written = 0; }
    if (limit.written === 0 || limit.written + next <= WINDOW_LIMIT) return;
    onProgress({ phase: "write", index, total: steps, waiting: true });
    await sleep(Math.max(0, limit.start + WINDOW_MS - t), signal);
    limit.start = now();
    limit.written = 0;
  };
  const undo = async () => {
    if (!created) return;
    try { await host.deleteBlock(container); } catch { /* nothing more to do */ }
  };
  try {
    await host.createBlock({
      parentUid: blockUid,
      order: existing ? existing.order : "last",
      uid: container,
      string: containerString({ from, to, pageCount: count }),
      props: parsedMarker({
        url: source.url,
        sha256: doc.sha256,
        from,
        to,
        pageCount: count,
        highlights: Boolean(refLines),
        at: new Date(now()).toISOString(),
      }),
      open: true,
    });
    created = true;
    limit.written += 1;
    let index = 0;
    for (const step of plan.steps) {
      if (signal?.aborted) { await undo(); return failedWith("aborted-write"); }
      index += 1;
      await throttle(index, step.kind === "md" ? bulletCount(step.markdown) : (Number(step.table.rows) || 0) * (Number(step.table.cols) || 0) + 2);
      if (signal?.aborted) { await undo(); return failedWith("aborted-write"); }
      onProgress({ phase: "write", index, total: steps });
      if (step.kind === "md") {
        await host.fromMarkdown({ parentUid: container, order: "last", markdown: step.markdown });
        const n = bulletCount(step.markdown);
        blocks += n;
        limit.written += n;
      } else {
        await writeTable(host, doc, container, step);
        const n = (Number(step.table.rows) || 0) * (Number(step.table.cols) || 0) + 2;
        blocks += n;
        limit.written += n;
      }
    }
    if (refLines) {
      if (signal?.aborted) { await undo(); return failedWith("aborted-write"); }
      await throttle(steps, bulletCount(refLines));
      onProgress({ phase: "write", index: steps, total: steps });
      await host.fromMarkdown({ parentUid: container, order: "last", markdown: refLines });
      blocks += bulletCount(refLines);
    }
    if (signal?.aborted) { await undo(); return failedWith("aborted-write"); }
    if (existing) await host.deleteBlock(existing.uid);
  } catch (error) {
    await undo();
    return failedWith("write-failed", { error });
  }
  return { ok: true, container, blocks, from, to, pages: total, note, helperReady };
}

let current = null;
let currentToast = null;

export function closeBlockParse() {
  current?.close();
  currentToast?.close();
}

function resultToast({ doc, host, text, undoUid, linger }) {
  currentToast?.close();
  const node = doc.createElement("div");
  node.className = "pxd-blockparse-toast";
  node.setAttribute("role", "status");
  const label = doc.createElement("span");
  label.className = "pxd-blockparse-toast__text";
  label.textContent = text;
  node.append(label);
  let timer = null;
  const api = {
    close() {
      if (currentToast === api) currentToast = null;
      globalThis.clearTimeout(timer);
      node.remove();
    },
  };
  if (undoUid) {
    const undo = doc.createElement("button");
    undo.type = "button";
    undo.className = "pxd-blockparse-toast__undo";
    undo.textContent = "Undo";
    // Removes only what this run wrote. An earlier parse it replaced is not restored; Roam's Cmd+Z still can.
    undo.onclick = () => {
      undo.disabled = true;
      Promise.resolve(host.deleteBlock(undoUid)).then(
        () => { api.close(); resultToast({ doc, host, text: "Removed the parsed blocks.", linger: 4000 }); },
        () => { undo.disabled = false; },
      );
    };
    node.append(undo);
  }
  doc.body.append(node);
  timer = globalThis.setTimeout(() => api.close(), linger);
  currentToast = api;
  return api;
}

export function openBlockParse({ doc = globalThis.document, host, pdfTables, blockUid, string, fetchBytes, say = () => {} } = {}) {
  current?.close();
  const source = pdfSourceOf(string);
  if (!source || !doc?.body) return null;
  const offs = [];
  const on = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };

  let rows = [];
  let coverTitle = "";
  if (source.kind === "pdf") {
    try {
      const cover = host.pdfCover?.(string);
      coverTitle = typeof cover?.title === "string" && cover.title !== "PDF" ? cover.title : "";
      if (cover?.pageUid) rows = highlightRows(host.pdfHighlightTree?.(cover.pageUid) || []).filter((row) => row.uid);
    } catch { rows = []; }
  }
  const existing = findParsedKid(host, blockUid);

  const box = el("div", "pxd-blockparse", doc.body);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Parse PDF");
  el("div", "pxd-blockparse__title", box, "Parse PDF");
  el("div", "pxd-blockparse__file", box, coverTitle || pdfFileTitle(source.url) || "PDF file");
  const stage = el("div", "pxd-blockparse__stage", box);
  const form = el("div", "pxd-blockparse__form", stage);

  const wholeRow = el("label", "pxd-blockparse__row", form);
  const wholeRadio = el("input", "pxd-blockparse__radio", wholeRow);
  wholeRadio.type = "radio";
  wholeRadio.name = "pxd-blockparse-range";
  wholeRadio.checked = true;
  el("span", "", wholeRow, "Whole PDF");
  const rangeRow = el("label", "pxd-blockparse__row", form);
  const rangeRadio = el("input", "pxd-blockparse__radio", rangeRow);
  rangeRadio.type = "radio";
  rangeRadio.name = "pxd-blockparse-range";
  el("span", "", rangeRow, "Pages");
  const fromInput = el("input", "pxd-blockparse__page", rangeRow);
  fromInput.type = "number";
  fromInput.min = "1";
  fromInput.setAttribute("aria-label", "First page");
  el("span", "", rangeRow, "to");
  const toInput = el("input", "pxd-blockparse__page", rangeRow);
  toInput.type = "number";
  toInput.min = "1";
  toInput.setAttribute("aria-label", "Last page");
  const ofLabel = el("span", "pxd-blockparse__of", rangeRow, "");

  let pageCount = null;
  let highlightBox = null;
  if (rows.length) {
    const hlRow = el("label", "pxd-blockparse__row", form);
    highlightBox = el("input", "pxd-blockparse__check", hlRow);
    highlightBox.type = "checkbox";
    el("span", "", hlRow, `Also bring in highlights (${rows.length})`);
  }
  if (existing) {
    const r = existing.record;
    const where = r.from != null && r.to != null ? (r.from === r.to ? `page ${r.from}` : `pages ${r.from}–${r.to}`) : "this PDF";
    const day = typeof r.at === "string" ? r.at.slice(0, 10) : "";
    el("div", "pxd-blockparse__prior", form, `Parsed before: ${where}${day ? `, ${day}` : ""}. Parsing again replaces it, including any edits under it.`);
  }
  const errorLine = el("div", "pxd-blockparse__error", form, "");
  errorLine.setAttribute("role", "alert");
  const buttons = el("div", "pxd-blockparse__buttons", box);
  const cancelBtn = el("button", "pxd-blockparse__cancel", buttons, "Cancel");
  cancelBtn.type = "button";
  const goBtn = el("button", "pxd-blockparse__go", buttons, existing ? "Replace" : "Parse");
  goBtn.type = "button";

  let closed = false;
  let controller = null;
  const close = () => {
    if (closed) return;
    closed = true;
    controller?.abort();
    if (current === api) current = null;
    for (const off of offs) off();
    box.remove();
  };
  const api = { close };
  current = api;

  Promise.resolve(pdfTables?.pageCountOf?.(source.url)).then((n) => {
    if (closed || !Number.isInteger(n)) return;
    pageCount = n;
    ofLabel.textContent = `of ${n}`;
    toInput.max = String(n);
    fromInput.max = String(n);
  }, () => {});

  const cancel = () => {
    if (controller) controller.abort();
    else close();
  };
  on(cancelBtn, "click", cancel);
  on(doc, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault?.();
    cancel();
  }, true);
  on(fromInput, "input", () => { rangeRadio.checked = true; });
  on(toInput, "input", () => { rangeRadio.checked = true; });

  const start = () => {
    errorLine.textContent = "";
    let range = { ok: true, whole: true, from: 1, to: pageCount };
    if (rangeRadio.checked) {
      range = parsePageRange(fromInput.value, toInput.value, pageCount);
      if (!range.ok) { errorLine.textContent = range.error; return; }
    }
    const chosen = highlightBox && highlightBox.checked ? rows : null;
    controller = new AbortController();
    form.remove();
    goBtn.remove();
    const status = el("div", "pxd-blockparse__status", stage, "Reading the PDF…");
    status.setAttribute("role", "status");
    const bar = el("progress", "pxd-blockparse__bar", stage);
    bar.max = 1;
    bar.value = 0;
    const onProgress = (p) => {
      if (closed) return;
      if (p.phase === "ocr") {
        status.textContent = `Reading ${p.total === 1 ? "1 scanned page" : `${p.total} scanned pages`} with the Plexus helper (OCR)…`;
        bar.removeAttribute("value");
      } else if (p.phase === "read") {
        status.textContent = `Reading page ${p.index} of ${p.total}`;
        bar.value = (p.index - 1) / Math.max(1, p.total);
      } else {
        status.textContent = p.waiting
          ? `Writing ${p.index} of ${p.total} · waiting for Roam's write limit`
          : `Writing ${p.index} of ${p.total}`;
        bar.value = (p.index - 1) / Math.max(1, p.total);
      }
    };
    runBlockParse({ host, pdfTables, blockUid, source, range, highlights: chosen, existing, signal: controller.signal, fetchBytes, onProgress }).then((result) => {
      close();
      if (result.ok) {
        const text = `Parsed ${result.pages} ${result.pages === 1 ? "page" : "pages"} into ${result.blocks} blocks.${result.note ? ` ${result.note}` : ""}`;
        resultToast({ doc, host, text, undoUid: result.container, linger: result.note ? 20000 : 12000 });
      } else if (result.reason === "aborted-read") say("Parse cancelled. Nothing was written.");
      else if (result.reason === "aborted-write") say("Parse cancelled. Nothing was kept.");
      else if (result.reason === "all-scans") {
        // Nothing is written when every page in the range is a scan, so the note says that instead of "placeholders".
        const text = String(result.note || ERRORS.empty).replace(/, so (?:it was|they were) left as (?:a placeholder|placeholders)\./, ". Nothing was written.");
        resultToast({ doc, host, text, linger: 20000 });
      }
      else say(ERRORS[result.reason] || ERRORS["write-failed"]);
    });
  };
  on(goBtn, "click", start);
  try { goBtn.focus(); } catch { /* the host has no focus */ }
  return api;
}
