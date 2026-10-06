import assert from "node:assert/strict";
import test from "node:test";

import { bundleBuildOptions } from "../build.mjs";
import {
  CSS_BUDGET_BYTES,
  JS_BUDGET_BYTES,
  gateSizes,
} from "../scripts/size-gate.mjs";
import { formatSizeReport, modulesByOutputBytes } from "../scripts/size-report.mjs";

function statFor({ js, css }) {
  return async (path) => {
    if (path.endsWith("extension.js")) return { size: js };
    if (path.endsWith("extension.css")) return { size: css };
    throw new Error(`unexpected path ${path}`);
  };
}

test("size gate passes under the budget", async () => {
  const result = await gateSizes({
    stat: statFor({ js: JS_BUDGET_BYTES - 1, css: CSS_BUDGET_BYTES - 1 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.message, "");
  assert.equal(result.js, JS_BUDGET_BYTES - 1);
  assert.equal(result.css, CSS_BUDGET_BYTES - 1);
});

test("size gate fails when either artifact is at the budget", async () => {
  const jsOver = await gateSizes({
    stat: statFor({ js: JS_BUDGET_BYTES, css: 100 }),
  });
  assert.equal(jsOver.ok, false);
  assert.match(jsOver.message, new RegExp(String(JS_BUDGET_BYTES)));
  assert.match(jsOver.message, /extension\.js/);
  assert.doesNotMatch(jsOver.message, /extension\.css/);

  const cssOver = await gateSizes({
    stat: statFor({ js: 100, css: CSS_BUDGET_BYTES + 50 }),
  });
  assert.equal(cssOver.ok, false);
  assert.match(cssOver.message, new RegExp(`extension\\.css is ${CSS_BUDGET_BYTES + 50} bytes`));
  assert.match(cssOver.message, new RegExp(`${CSS_BUDGET_BYTES} bytes \\(90 KB\\)`));
});

test("size report sorts modules by output bytes and keeps 15", () => {
  const inputs = {};
  for (let i = 0; i < 20; i += 1) {
    inputs[`src/m${String(i).padStart(2, "0")}.js`] = { bytesInOutput: i * 10 };
  }
  inputs["src/tie-b.js"] = { bytesInOutput: 155 };
  inputs["src/tie-a.js"] = { bytesInOutput: 155 };
  const ranked = modulesByOutputBytes({
    outputs: { "extension.js": { bytes: 1, inputs } },
  });
  assert.equal(ranked.length, 15);
  assert.equal(ranked[0].path, "src/m19.js");
  assert.equal(ranked[0].bytes, 190);
  assert.deepEqual(ranked.slice(0, 3).map((row) => row.bytes), [190, 180, 170]);
  const tieA = ranked.findIndex((row) => row.path === "src/tie-a.js");
  const tieB = ranked.findIndex((row) => row.path === "src/tie-b.js");
  assert.ok(tieA !== -1 && tieB !== -1);
  assert.ok(tieA < tieB);
  assert.equal(ranked.some((row) => row.path === "src/m00.js"), false);
  assert.equal(ranked.some((row) => row.path === "src/m04.js"), false);

  const text = formatSizeReport({
    jsBytes: 10,
    cssBytes: 20,
    modules: ranked,
    measured: "2026-10-06",
  });
  assert.match(text, /\| 190 \| `src\/m19\.js` \|/);
  assert.doesNotMatch(text, /src\/m04\.js/);
  assert.match(text, /\| extension\.js \| 10 \|/);
  assert.match(text, /\| extension\.css \| 20 \|/);
  assert.match(text, /900 KB/);
  assert.match(text, /90 KB/);
  assert.match(text, /node scripts\/size-report\.mjs --write docs\/size\.md/);
});

test("bundle options stay the shared build config", () => {
  const options = bundleBuildOptions({ metafile: true, banner: "/* x */" });
  assert.equal(options.metafile, true);
  assert.deepEqual(options.entryPoints, ["src/extension.js"]);
  assert.equal(options.write, false);
  assert.equal(options.bundle, true);
  assert.equal(options.outfile, "extension.js");
  assert.deepEqual(options.banner, { js: "/* x */" });
});
