import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build as esbuild } from "esbuild";

import { bundleBuildOptions, depotForbiddenInputs } from "../build.mjs";
import { parseDropPayload } from "../src/model/drop.js";
import { initializeSettings, normalizeSetting, settingsDefaults } from "../src/settings.js";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const MARKERS = ["ortUrl", "module_or_path", "anydoc_wasm_bg", "ORT_BASE"];

async function bundleSmall(source, depot) {
  const directory = await mkdtemp(resolve(tmpdir(), "pxd-depot-"));
  try {
    const entry = resolve(rootPath, `src/.depot-probe-${process.pid}-${depot ? "d" : "p"}.mjs`);
    await writeFile(entry, source, "utf8");
    try {
      const options = bundleBuildOptions({ rootDirectory: rootPath, entryPoint: entry.slice(rootPath.length), depot });
      const out = await esbuild({ ...options, write: false });
      return out.outputFiles[0].text;
    } finally {
      await rm(entry, { force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the Depot bundle has no OCR or anydoc module inputs", async () => {
  assert.deepEqual(await depotForbiddenInputs(rootPath), []);
});

test("root extension.js (Depot) lacks the OCR and anydoc code, deploy/extension.js (Pages) has it", async () => {
  const [depot, pages] = await Promise.all([
    readFile(resolve(rootPath, "extension.js"), "utf8"),
    readFile(resolve(rootPath, "deploy/extension.js"), "utf8"),
  ]);
  for (const marker of MARKERS) {
    assert.equal(depot.includes(marker), false, `${marker} in Depot build`);
  }
  assert.ok(pages.includes("anydoc_wasm_bg"));
  assert.ok(pages.includes("ortUrl") || pages.includes("ORT_BASE"));
});

test("the swap gives a null anydoc host, a null OCR source, and DEPOT_BUILD true only in the Depot flavour", async () => {
  const source = [
    'import { createAnydocHost } from "./host/anydoc.js";',
    'import { sharedDeviceOcr } from "./host/device-ocr.js";',
    'import { DEPOT_BUILD } from "./host/build-flavor.js";',
    "export default { host: createAnydocHost(), ocr: sharedDeviceOcr(), depot: DEPOT_BUILD };",
  ].join("\n");
  const depotText = await bundleSmall(source, true);
  const depot = await import(`data:text/javascript;base64,${Buffer.from(depotText).toString("base64")}`);
  assert.equal(depot.default.host, null);
  assert.equal(depot.default.ocr, null);
  assert.equal(depot.default.depot, true);
  const pagesText = await bundleSmall('import { DEPOT_BUILD } from "./host/build-flavor.js";\nexport default DEPOT_BUILD;', false);
  const pages = await import(`data:text/javascript;base64,${Buffer.from(pagesText).toString("base64")}`);
  assert.equal(pages.default, false);
});

test("the Depot engines list has no In-browser reading row; the Pages list keeps it", async () => {
  const source = 'import { engineRows } from "./view/engines-panel.js";\nexport default engineRows({ device: { state: "not-downloaded", mb: 39 } }).map((row) => row.id);';
  const depotText = await bundleSmall(source, true);
  const depot = await import(`data:text/javascript;base64,${Buffer.from(depotText).toString("base64")}`);
  assert.deepEqual(depot.default, ["device", "helper", "cloud"]);
  const pagesText = await bundleSmall(source, false);
  const pages = await import(`data:text/javascript;base64,${Buffer.from(pagesText).toString("base64")}`);
  assert.deepEqual(pages.default, ["device", "device-ocr", "helper", "cloud"]);
});

test("with office false a dropped file, a uri and a block ref give no office rows", () => {
  const data = (map, files = []) => ({
    getData: (type) => map[type] || "",
    files,
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    types: Object.keys(map),
  });
  const file = { name: "notes.docx", arrayBuffer: async () => new ArrayBuffer(0) };
  const url = "https://example.com/files/report.docx";
  const dropFile = data({}, [file]);
  assert.ok(parseDropPayload(dropFile).some((row) => row.office));
  assert.equal(parseDropPayload(dropFile, { office: false }).some((row) => row.office), false);
  const dropUri = data({ "text/uri-list": url, "text/plain": url });
  assert.ok(parseDropPayload(dropUri).some((row) => row.office));
  assert.equal(parseDropPayload(dropUri, { office: false }).some((row) => row.office), false);
  const dropBlock = data({ "roam/block-uid-list": "abc123XYZ" });
  const resolveUid = () => `[report](${url})`;
  assert.ok(parseDropPayload(dropBlock, { resolveUid }).some((row) => row.office));
  assert.equal(parseDropPayload(dropBlock, { resolveUid, office: false }).some((row) => row.office), false);
});

test("auto-enhance seeds false on a fresh API, keeps a saved true or false, coerces strings", async () => {
  const seed = async (saved) => {
    const store = new Map(saved === undefined ? [] : [["auto-enhance", saved]]);
    await initializeSettings({ settings: { get: (id) => store.get(id) ?? null, set: async (id, v) => { store.set(id, v); } } });
    return store.get("auto-enhance");
  };
  assert.equal(settingsDefaults()["auto-enhance"], false);
  assert.equal(await seed(undefined), false);
  assert.equal(await seed(true), true);
  assert.equal(await seed(false), false);
  assert.equal(normalizeSetting("auto-enhance", "true"), true);
  assert.equal(normalizeSetting("auto-enhance", "false"), false);
});
