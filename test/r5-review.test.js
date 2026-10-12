// Round-5 review fixes in board-view that a unit stub cannot reach: the PDF name cache key and the ident-load repaint.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");

test("pdfNameOf caches the page names by uid and url, so parts with no PDF block uid do not share one name", () => {
  const body = view.slice(view.indexOf("const pdfNameOf = (card) => {"), view.indexOf("const wantPdfNames ="));
  assert.match(body, /const infoKey = `\$\{uid\}\\n\$\{url\}`;/);
  assert.match(body, /pdfNameInfo\.get\(infoKey\)/);
  assert.match(body, /pdfNameInfo\.set\(infoKey, info\)/);
  assert.doesNotMatch(body, /pdfNameInfo\.(get|set)\(uid\b/);
});

test("the first-page name cache repaints the board only when a PDF card on it has a name to show", () => {
  const body = view.slice(view.indexOf("identTitleOf = (url) => {"), view.indexOf("setPdfNameResolver("));
  const guard = body.indexOf("if (!named) return;");
  assert.ok(guard > 0);
  assert.ok(guard < body.indexOf("repaintStyles"), "the guard runs before the repaint");
});
