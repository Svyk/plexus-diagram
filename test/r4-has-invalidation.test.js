// R4: a :has() whose anchor is not the subject puts the subject's classes in the style invalidation set that Blink
// applies under every :has() anchor above the board (Roam's own CSS has such anchors). With a card header or body
// there, every DOM change in the board restyled every card header and body (headless: 41 ms and 3,179 elements per
// mutation on the 1,560-card fixture, 4 ms and 77 after). Anchors above the board make it run for every change.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { SIDEBAR_PDF_CLASS, sidebarPdfDirty, syncSidebarPdf } from "../src/view/sidebar-pdf.js";

const cssDir = new URL("../src/css/", import.meta.url);
const css = [readFileSync(new URL("../src/extension.css", import.meta.url), "utf8"),
  ...readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(new URL(f, cssDir), "utf8"))]
  .join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(text) {
  const out = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(text))) {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) continue;
    let depth = 0;
    let cur = "";
    for (const ch of head) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// Top-level compounds of a complex selector (combinators outside parentheses split them).
function compounds(sel) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < sel.length; i += 1) {
    const ch = sel[i];
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (depth === 0 && (ch === " " || ch === ">" || ch === "~" || ch === "+")) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Elements there are hundreds or thousands of on a big board.
const MANY = ["pxd-item__body", "pxd-item__header", "pxd-item", "pxd-rs", "pxd-item__string", "pxd-item__badges", "pxd-edge", "pxd-grip", "pxd-ports", "rm-block-main", "roam-block-container", "rm-block__input"];
// Ancestors of a board: a :has() there is evaluated for every change inside the board.
const ABOVE = ["roam-app", "roam-main", "roam-article", "roam-body-main", "flex-h-box", "pxd-world", "pxd-viewport", "pxd-items"];

test("R4: no :has() puts a high-count board element on its right, or anchors on a board ancestor", () => {
  const bad = [];
  for (const sel of selectors(css)) {
    if (!sel.includes(":has(")) continue;
    const parts = compounds(sel);
    const last = parts.length - 1;
    parts.forEach((part, i) => {
      if (!part.includes(":has(")) return;
      const bare = part.replace(/:has\((?:[^()]|\([^()]*\))*\)/g, "").replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
      if (ABOVE.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(bare))) bad.push(`anchor above the board: ${sel}`);
      if (i === last) return;
      const subject = parts[last].replace(/::?[\w-]+(\([^)]*\))?$/g, "");
      if (MANY.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject)) || /^(img|span|div|\*)?$/.test(subject.replace(/\.[\w-]+/g, "").replace(/\[[^\]]*\]/g, "")) && /(^|\s)(img|span|div)\b/.test(parts[last])) {
        bad.push(`high-count subject right of :has(): ${sel}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

function fakeDoc() {
  const classes = new Set();
  const html = { classList: { contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), remove: (c) => classes.delete(c) } };
  const pdfs = [];
  const sidebar = {
    id: "right-sidebar", nodeType: 1, classList: { contains: () => false },
    contains: (n) => n === sidebar || n?.parent === sidebar,
    matches: () => false,
    querySelector: (s) => (s === ".rm-pdf-container" ? pdfs[0] || null : null),
  };
  const doc = {
    documentElement: html,
    getElementById: (id) => (id === "right-sidebar" ? sidebar : null),
    getElementsByClassName: () => [],
  };
  return { doc, sidebar, pdfs, classes };
}

test("R4: <html> carries pxd-sidebar-pdf only while the right sidebar holds a PDF", () => {
  const { doc, sidebar, pdfs, classes } = fakeDoc();
  assert.equal(syncSidebarPdf(doc), false);
  const pdf = { nodeType: 1, parent: sidebar, matches: (s) => s === ".rm-pdf-container", querySelector: () => null };
  pdfs.push(pdf);
  const added = [{ target: sidebar, addedNodes: [pdf], removedNodes: [] }];
  assert.equal(sidebarPdfDirty(added, false, doc), true);
  assert.equal(syncSidebarPdf(doc), true);
  assert.equal(classes.has(SIDEBAR_PDF_CLASS), true);
  // A change inside the board (not under the sidebar) does not look.
  const boardNode = { nodeType: 1 };
  assert.equal(sidebarPdfDirty([{ target: boardNode, addedNodes: [{ nodeType: 1, matches: () => false, contains: () => false, querySelector: () => null }], removedNodes: [] }], true, doc), false);
  pdfs.length = 0;
  assert.equal(sidebarPdfDirty([{ target: sidebar, addedNodes: [], removedNodes: [pdf] }], true, doc), true);
  assert.equal(syncSidebarPdf(doc), false);
  assert.equal(classes.has(SIDEBAR_PDF_CLASS), false);
});
