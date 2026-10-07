// R3. Follow-Roam colour math and the sampler that writes tokens on .pxd-root.
import assert from "node:assert/strict";
import test from "node:test";

import { applyThemeVars, contrast, deriveTheme, THEME_VARS } from "../src/model/theme-colors.js";
import { normalizeSetting, settingsDefaults } from "../src/settings.js";
import { createThemeFollow } from "../src/view/theme-follow.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const FILL = /--pxd-[a-z0-9-]*fill|--pxd-bg\b/;

test("deriveTheme mixes the card 4% toward the ink and refuses a low-contrast sample", () => {
  const light = deriveTheme({ background: "#ffffff", text: "#000000", link: "#0055aa" });
  assert.equal(light.dark, false);
  assert.equal(light.vars["--pxd-card"], "rgb(245, 245, 245)");
  assert.match(light.vars["--pxd-accent-soft"], /rgba\(0, 85, 170, 0\.18\)/);
  assert.ok(contrast("#000000", light.vars["--pxd-card"]) >= 4.5);
  for (const key of Object.keys(light.vars)) assert.equal(FILL.test(key), false, key);

  const dark = deriveTheme({ background: "#111111", text: "#f2f2f2", dark: true, link: "#7dcaa8" });
  assert.equal(dark.dark, true);
  assert.match(dark.vars["--pxd-accent-soft"], /, 0\.22\)$/);
  for (const key of Object.keys(dark.vars)) assert.equal(FILL.test(key), false, key);
  for (const name of THEME_VARS) assert.equal(typeof dark.vars[name], "string");

  assert.equal(deriveTheme({ background: "#888888", text: "#777777" }), null);
  assert.equal(deriveTheme({ background: "rgba(255, 255, 255, 0.2)", text: "#000000" }), null);
  assert.equal(deriveTheme({}), null);
});

test("applyThemeVars writes the token list and clears it when the sample is unusable", () => {
  const style = {
    setProperty(name, value) { this[name] = String(value); },
    removeProperty(name) { delete this[name]; },
  };
  applyThemeVars(style, { "--pxd-text": "rgb(0, 0, 0)", "--pxd-bg": "rgb(1, 1, 1)", "--pxd-note-fill": "red" });
  assert.equal(style["--pxd-text"], "rgb(0, 0, 0)");
  assert.equal(style["--pxd-bg"], undefined);
  assert.equal(style["--pxd-note-fill"], undefined);
  applyThemeVars(style, null);
  assert.equal(style["--pxd-text"], undefined);
});

test("theme setting defaults to follow-roam and rejects an unknown value", () => {
  assert.equal(settingsDefaults().theme, "follow-roam");
  assert.equal(normalizeSetting("theme", "plexus"), "plexus");
  assert.equal(normalizeSetting("theme", "nope"), "follow-roam");
});

function paintRoam(stub, { background, text, link }) {
  const main = stub.document.createElement("div");
  main.className = "roam-body-main";
  main.style.setProperty("background-color", background);
  const article = stub.document.createElement("div");
  article.className = "roam-article";
  article.style.setProperty("color", text);
  const ref = stub.document.createElement("span");
  ref.className = "rm-page-ref";
  ref.style.setProperty("color", link);
  stub.document.body.append(main, article, ref);
}

test("follow-roam paints --pxd-text and plexus clears the class and the tokens", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    paintRoam(stub, { background: "#ffffff", text: "#111111", link: "#0055aa" });
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    let mode = "follow-roam";
    const follow = createThemeFollow({ doc: stub.document, root, getMode: () => mode });
    follow.apply();
    assert.equal(root.classList.contains("pxd-theme--roam"), true);
    assert.match(String(root.style["--pxd-text"] || ""), /^rgb\(/);
    assert.equal(FILL.test(Object.keys(root.style).join(" ")), false);

    mode = "plexus";
    follow.apply();
    assert.equal(root.classList.contains("pxd-theme--roam"), false);
    assert.equal(root.style["--pxd-text"], undefined);
  } finally {
    restore();
  }
});

test("a transparent main background falls through to the body colour", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const main = stub.document.createElement("div");
    main.className = "roam-body-main";
    main.style.setProperty("background-color", "rgba(0, 0, 0, 0)");
    stub.document.body.style.setProperty("background-color", "#202b33");
    stub.document.body.style.setProperty("color", "#e1e8ed");
    const article = stub.document.createElement("div");
    article.className = "roam-article";
    article.style.setProperty("color", "rgb(225, 232, 237)");
    article.style.setProperty("background-color", "rgb(32, 43, 51)");
    stub.document.body.append(main, article);
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const follow = createThemeFollow({ doc: stub.document, root, getMode: () => "follow-roam" });
    follow.apply();
    assert.equal(root.classList.contains("pxd-theme--roam"), true);
    assert.equal(root.style["--pxd-surface"], "rgb(32, 43, 51)");
    assert.match(String(root.style["--pxd-text"] || ""), /^rgb\(225, 232, 237\)$/);
  } finally {
    restore();
  }
});

function paintBorder(extra) {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const main = stub.document.createElement("div");
    main.className = "roam-body-main";
    main.style.setProperty("background-color", "#202b33");
    const article = stub.document.createElement("div");
    article.className = "roam-article";
    article.style.setProperty("color", "rgb(225, 232, 237)");
    const block = stub.document.createElement("div");
    block.className = "roam-block-container";
    block.style.setProperty("border-top-color", extra.color);
    block.style.setProperty("border-top-width", extra.width);
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(main, article, block, root);
    createThemeFollow({ doc: stub.document, root, getMode: () => "follow-roam" }).apply();
    return root.style["--pxd-border"];
  } finally {
    restore();
  }
}

test("a zero-width currentColor border is synthesized, and a real rule is kept", () => {
  assert.notEqual(paintBorder({ color: "rgb(225, 232, 237)", width: "0px" }), "rgb(225, 232, 237)");
  assert.equal(paintBorder({ color: "rgb(80, 90, 100)", width: "1px" }), "rgb(80, 90, 100)");
});

test("an empty colour sample adds no theme class", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const follow = createThemeFollow({ doc: stub.document, root, getMode: () => "follow-roam" });
    follow.apply();
    assert.equal(root.classList.contains("pxd-theme--roam"), false);
    assert.equal(root.style["--pxd-text"], undefined);
    follow.start();
    follow.stop();
  } finally {
    restore();
  }
});

test("--pxd-link keeps Roam's block link colour when it reads on the card, else the accent", () => {
  const dark = { background: "rgb(32, 43, 51)", text: "rgb(225, 232, 237)", link: "rgb(129, 140, 248)", dark: true };
  assert.equal(deriveTheme(dark).vars["--pxd-link"], "rgb(129, 140, 248)");
  const faint = deriveTheme({ ...dark, link: "rgb(40, 50, 60)" });
  assert.equal(faint.vars["--pxd-link"], faint.vars["--pxd-accent"]);
  assert.equal(THEME_VARS.includes("--pxd-link"), true);
});
