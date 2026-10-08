// SHA-256 of the vendored @firecrawl/anydoc-wasm 0.2.4 files in assets/anydoc/.
// The host checks fetched bytes against this before instantiate. Keep it identical
// to assets/anydoc/manifest.json.

export const ANYDOC_MANIFEST = Object.freeze({
  name: "@firecrawl/anydoc-wasm",
  version: "0.2.4",
  files: Object.freeze({
    "anydoc_wasm.js": Object.freeze({
      sha256: "4860ad4c02c523593a5dae7698e186e8d7cf75a0e0bf3c2c294373de58eaee74",
      bytes: 14366,
    }),
    "anydoc_wasm_bg.wasm": Object.freeze({
      sha256: "9f37cd53b17bf4028ac5ae6a2ac4cf625e9c53be511797168780bab495de1a9e",
      bytes: 6691779,
    }),
  }),
});
