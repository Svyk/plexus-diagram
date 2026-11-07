// PXD-21: Roam's own PDF reader in the right sidebar shows its whole toolbar and takes the theme's surface in dark.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/css/read-pane.css", import.meta.url), "utf8");
const built = readFileSync(new URL("../extension.css", import.meta.url), "utf8");

test("Roam's PDF window is a size container; readers inside a board are left out", () => {
  assert.match(css, /\.rm-pdf-container:not\(\.pxd-root \.rm-pdf-container\):not\(\.pxd-read \.rm-pdf-container\) \{\s*container: pxd-roam-pdf \/ inline-size;/);
});

test("below 560 px the toolbar wraps onto two rows and the pages start under it", () => {
  const block = css.slice(css.indexOf("@container pxd-roam-pdf (max-width: 559px)"));
  assert.ok(block.length > 0, "container query present");
  const body = block.slice(0, block.indexOf("\n}\n"));
  assert.match(body, /\.rm-pdf-toolbar \{[^}]*flex-wrap: wrap;[^}]*height: 72px;/);
  assert.match(body, /\.rm-pdf-toolbar > \.bp3-button-group \{\s*display: contents;/);
  assert.match(body, /\.rm-pdf-viewer-container \{\s*top: 72px !important;/);
});

test("dark: toolbar and page bed are transparent, no fixed near-black surface", () => {
  assert.match(css, /html\.pxd-pdf-reader-dark:not\(\.rm-sidecar\) \.rm-pdf-toolbar \{\s*background: transparent;/);
  assert.match(css, /html\.pxd-pdf-reader-dark:not\(\.rm-sidecar\) \.rm-pdf-container,\s*html\.pxd-pdf-reader-dark:not\(\.rm-sidecar\) \.PdfHighlighter \{\s*background: transparent;/);
  assert.doesNotMatch(css, /\.rm-pdf-toolbar \{\s*background: #252a31/);
});

test("the built stylesheet carries the rules", () => {
  assert.ok(built.includes("pxd-roam-pdf"));
});
