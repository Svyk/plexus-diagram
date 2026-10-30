// Splits the bundle into a start-up core and pieces of rarely used code. Roam Depot publishes only
// extension.js and extension.css, and remote code is off the table, so a piece travels inside
// extension.js as deflated text and is evaluated on its first call (src/piece-loader.js).
//
// PIECES names root modules. Every other module that only those roots reach goes with them. Core code
// keeps its imports and calls: each root import is swapped for a generated module of forwarders, so
// no call site changes and a call stays synchronous. A piece reaches core modules through a table
// the core fills in at start, so each module exists once.
import { build as esbuild } from "esbuild";
import { deflateSync, strToU8 } from "fflate";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const NS_FACADE = "plexus-facade";
const NS_CORE = "plexus-core";
const NS_ENTRY = "plexus-entry";
const RUNTIME = "src/piece-loader.js";

export const PIECES = {
  "changelog": [
    "src/changelog-text.js"
  ],
  "parse": [
    "src/model/parse/",
    "src/model/ocr/",
    "src/host/ocr-web.js",
    "src/host/ocr-ort.js",
    "src/host/device-ocr.js",
    "src/host/cloud-parse.js",
    "src/host/anydoc.js",
    "src/model/anydoc-to-parse.js",
    "src/model/cloud-to-parse.js",
    "src/model/cloud-merge.js",
    "src/view/parse-view.js",
    "src/view/parse-engine.js",
    "src/view/parse-motion.js",
    "src/view/card-parse-motion.js",
    "src/view/engines-panel.js",
    "src/view/parse-crop.js",
    "src/view/parse-actions.js",
    "src/view/parse-status.js",
    "src/view/engine-tags.js",
    "src/view/cloud-confirm.js",
    "src/host/pdf-tables.js"
  ],
  "read": [
    "src/view/read-pane.js",
    "src/view/read-drawer.js",
    "src/model/read-pane-model.js",
    "src/model/read-drawer-model.js",
    "src/view/text-layer.js"
  ],
  "ai": [
    "src/view/ask-ai.js",
    "src/view/ask-composer.js",
    "src/model/ask-composer.js",
    "src/model/ask-parts.js",
    "src/model/ai-context.js",
    "src/model/highlight-ask.js",
    "src/host/liveai.js",
    "src/view/chart-table.js",
    "src/model/chart-data.js"
  ],
  "views": [
    "src/view/kanban-view.js",
    "src/view/table-view.js",
    "src/view/timeline.js",
    "src/view/present.js",
    "src/view/later-views.js",
    "src/view/lane-bar.js",
    "src/model/mindmap.js",
    "src/model/kanban.js"
  ],
  "io": [
    "src/model/json-canvas.js",
    "src/model/picture.js"
  ],
  "tools": [
    "src/view/panel.js",
    "src/view/shortcut-sheet.js",
    "src/view/view-dialog.js",
    "src/view/contexts-drawer.js",
    "src/view/region-delete-dialog.js",
    "src/view/pdf-pages-dialog.js",
    "src/view/quicklook.js"
  ]
};

// Exports that build a view at board mount. See pieceDefer in src/piece-loader.js.
export const DEFERRED = {
  "src/view/panel.js": {
    "createPanel": {
      "calls": {
        "currentTab": "",
        "isOpen": false,
        "infoTabs": [],
        "relatedQuery": "",
        "refreshOutline": null,
        "refreshSearch": null,
        "refreshBoards": null,
        "refreshPdfNames": null,
        "refreshChanged": null,
        "refreshTrails": null,
        "refreshViews": null,
        "refreshMarks": null,
        "close": null,
        "dispose": null
      },
      "props": {
        "el": null
      },
      "replay": [
        "setSelection",
        "setIndexing"
      ]
    }
  },
  "src/view/quicklook.js": {
    "createQuickLook": {
      "calls": {
        "isOpen": false,
        "close": null,
        "dispose": null
      }
    }
  },
  "src/view/present.js": {
    "createPresenter": {
      "calls": {
        "isActive": false,
        "index": 0,
        "total": 0,
        "stop": null,
        "dispose": null
      }
    }
  },
  "src/view/shortcut-sheet.js": {
    "createShortcutSheet": {
      "calls": {
        "isOpen": false,
        "close": null
      }
    }
  },
  "src/view/table-view.js": {
    "mountTable": {
      "calls": {
        "close": null,
        "refresh": null,
        "dispose": null
      }
    }
  },
  "src/view/kanban-view.js": {
    "mountKanban": {
      "calls": {
        "close": null,
        "refresh": null,
        "dispose": null
      }
    }
  },
  "src/view/later-views.js": {
    "mountLater": {
      "calls": {
        "isOpen": false,
        "mode": null,
        "close": null,
        "refresh": null,
        "dispose": null
      }
    }
  },
  "src/host/anydoc.js": {
    "createAnydocHost": {}
  },
  "src/host/pdf-tables.js": {
    "createPdfTables": {}
  },
  "src/host/device-ocr.js": {
    "sharedDeviceOcr": {}
  }
};

function reach(graph, from, stop) {
  const seen = new Set();
  const stack = [...from];
  while (stack.length) {
    const path = stack.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    for (const next of graph[path] || []) if (!stop.has(next)) stack.push(next);
  }
  return seen;
}

function matches(path, patterns) {
  return patterns.some((pattern) => (pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern));
}

// Which modules go where. A piece lists modules or folders; what only they reach goes with them. A
// module two pieces share would exist twice, so it stays in the core. Roots are the modules of a
// piece that something outside it imports: those get forwarders.
export function assignModules(metafile, pieces, entry) {
  const graph = {};
  for (const [path, input] of Object.entries(metafile.inputs)) {
    graph[path] = input.imports.filter((edge) => edge.kind === "import-statement").map((edge) => edge.path);
  }
  const members = new Map();
  for (const path of Object.keys(graph)) {
    if (path === entry || path === RUNTIME) continue;
    for (const [name, patterns] of Object.entries(pieces)) if (matches(path, patterns)) members.set(path, name);
  }
  const stop = new Set(members.keys());
  const core = reach(graph, [entry, RUNTIME], stop);
  for (;;) {
    const owner = new Map(members);
    let shared = null;
    for (const [path, name] of members) {
      for (const module of reach(graph, [path], stop)) {
        if (core.has(module) || members.has(module)) continue;
        if (owner.has(module) && owner.get(module) !== name) shared = module;
        else owner.set(module, name);
      }
    }
    if (!shared) {
      const roots = new Map();
      for (const [path, importsOf] of Object.entries(graph)) {
        const from = owner.get(path);
        for (const target of importsOf) {
          if (members.has(target) && owner.get(target) !== from) roots.set(target, owner.get(target));
          if (owner.has(target) && !members.has(target) && owner.get(target) !== from) roots.set(target, owner.get(target));
        }
      }
      return { core, owner, roots, graph };
    }
    for (const module of reach(graph, [shared], stop)) core.add(module);
  }
}

async function exportNames(root, path) {
  const result = await esbuild({
    absWorkingDir: root, entryPoints: [path], bundle: true, write: false, format: "esm", outfile: "out.js",
    platform: "browser", metafile: true, logLevel: "silent", external: ["*.wasm"],
  });
  return Object.values(result.metafile.outputs)[0].exports;
}

// Function exports forward. Plain data is copied in, so reading a constant does not load the piece.
async function facadeSource(root, path, piece, runtimeImport, deferred) {
  const names = await exportNames(root, path);
  const live = await import(pathToFileURL(resolve(root, path)).href);
  const lines = [`import { pieceDefer, pieceLoad } from ${JSON.stringify(runtimeImport)};`];
  const seen = [];
  for (const name of names) {
    const value = live[name];
    const local = name === "default" ? "defaultExport" : name;
    if (typeof value === "function") {
      if (/^class\b/.test(Function.prototype.toString.call(value))) {
        throw new Error(`${path}: ${name} is a class; a forwarder cannot stand in for it`);
      }
      const idle = deferred?.[path]?.[name];
      if (idle) {
        lines.push(`export const ${local} = (...args) => pieceDefer(() => pieceLoad(${JSON.stringify(piece)}, ${JSON.stringify(path)}).${name}(...args), ${JSON.stringify(idle)});`);
        seen.push(name);
        continue;
      }
      lines.push(`export ${name === "default" ? "default " : "const " + local + " = "}function (...args) { return pieceLoad(${JSON.stringify(piece)}, ${JSON.stringify(path)}).${name}.apply(this, args); };`);
    } else {
      const text = value instanceof RegExp ? String(value) : JSON.stringify(value);
      const same = value instanceof RegExp || value === undefined || (text !== undefined && isDeepStrictEqual(JSON.parse(text), value));
      // Left out: esbuild then refuses the build if outside code imports it, which is the signal to move it.
      if (!same || (text && text.length > 2048)) continue;
      lines.push(`export ${name === "default" ? "default " : "const " + local + " = "}${text};`);
    }
    seen.push(name);
  }
  return { source: `${lines.join("\n")}\n`, names: seen };
}

function makeFacadePlugin({ root, plan, importer, deferred }) {
  return {
    name: "plexus-facades",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.skip || args.namespace === NS_ENTRY && args.path.startsWith("plexus-")) return undefined;
        if (args.kind !== "import-statement" && args.kind !== "entry-point") return undefined;
        const found = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { skip: true } });
        if (found.errors.length || found.external) return found;
        const rel = found.path.startsWith(root + "/") ? found.path.slice(root.length + 1) : null;
        if (!rel) return found;
        return importer(rel, found);
      });
      build.onLoad({ filter: /.*/, namespace: NS_FACADE }, async (args) => {
        const piece = plan.roots.get(args.path);
        const { source } = await facadeSource(root, args.path, piece, `${root}/${RUNTIME}`, deferred);
        return { contents: source, resolveDir: root, loader: "js" };
      });
    },
  };
}

// fflate rather than node:zlib: zlib's output differs between CPUs, and extension.js must build to
// the same bytes here, in CI and on Depot's runner.
function encodePiece(text) {
  return Buffer.from(deflateSync(strToU8(text), { level: 9 })).toString("base64");
}

const CLASS_TOKEN = /\.(pxd-[\w-]+)/g;

// True when `code` can spell the class, literally or as a prefix glued to a value.
function spells(code, token) {
  if (code.includes(token)) return true;
  for (let i = token.length - 1; i > 4; i -= 1) {
    if (token[i - 1] !== "-" && token[i - 1] !== "_") continue;
    const stem = token.slice(0, i);
    if (code.includes(`${stem}\${`) || code.includes(`${stem}"+`) || code.includes(`${stem}\`+`)) return true;
  }
  return false;
}

// One top-level step through minified CSS: returns the end of the rule that starts at `from`.
function ruleEnd(css, from) {
  let depth = 0;
  let quote = "";
  for (let i = from; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i + 1;
    else if (ch === ";" && depth === 0) return i + 1;
  }
  return css.length;
}

// A rule moves into a piece only if every selector in it names a class that only that piece's code
// can create, so it cannot match anything on a board until the piece has run.
export function splitCss(css, coreCode, pieceCodes) {
  const owners = new Map();
  const ownerOf = (token) => {
    if (owners.has(token)) return owners.get(token);
    let owner = null;
    if (!spells(coreCode, token)) {
      const names = Object.keys(pieceCodes).filter((name) => spells(pieceCodes[name], token));
      if (names.length === 1) owner = names[0];
    }
    owners.set(token, owner);
    return owner;
  };
  const pieceOfSelector = (selector) => {
    const parts = selector.split(",");
    let piece = null;
    for (const part of parts) {
      const tokens = [...part.matchAll(CLASS_TOKEN)].map((match) => ownerOf(match[1])).filter(Boolean);
      if (!tokens.length) return null;
      if (piece && !tokens.includes(piece)) return null;
      piece ??= tokens[0];
    }
    return piece;
  };
  const eager = [];
  const lazy = {};
  const put = (bucket, text) => bucket.push(text);
  const walk = (text, wrapOpen) => {
    const keep = [];
    const moved = {};
    for (let at = 0; at < text.length;) {
      const end = ruleEnd(text, at);
      const rule = text.slice(at, end);
      at = end;
      const brace = rule.indexOf("{");
      const head = brace < 0 ? rule : rule.slice(0, brace);
      if (/^@(media|supports|container)/.test(head)) {
        const inner = walk(rule.slice(brace + 1, -1), head);
        if (inner.keep) keep.push(`${head}{${inner.keep}}`);
        for (const [name, body] of Object.entries(inner.moved)) (moved[name] ||= []).push(`${head}{${body}}`);
      } else {
        const piece = brace < 0 || head.startsWith("@") ? null : pieceOfSelector(head);
        if (piece) (moved[piece] ||= []).push(rule);
        else keep.push(rule);
      }
    }
    return { keep: keep.join(""), moved: Object.fromEntries(Object.entries(moved).map(([name, list]) => [name, list.join("")])), wrapOpen };
  };
  const result = walk(css);
  put(eager, result.keep);
  Object.assign(lazy, result.moved);
  return { eager: eager.join(""), lazy };
}

export async function buildPieces({ root, options, css, pieces = PIECES, deferred = DEFERRED, entry = "src/extension.js" }) {
  const scan = await esbuild({ ...options, metafile: true, minify: false, banner: undefined });
  const plan = assignModules(scan.metafile, pieces, entry);
  const coreList = [...new Set([RUNTIME, ...[...plan.owner.keys()].flatMap((path) => plan.graph[path] || [])])]
    .filter((path) => !plan.owner.has(path) && path.startsWith("src/"))
    .sort();
  const needCore = (rel) => {
    const index = coreList.indexOf(rel);
    if (index < 0) throw new Error(`${rel} is not in the core table`);
    return index;
  };
  const outputs = {};
  const rootsOf = {};
  for (const name of Object.keys(pieces)) {
    const roots = [...plan.roots].filter(([, owner]) => owner === name).map(([path]) => path).sort();
    rootsOf[name] = roots;
    const entrySource = roots.map((path, index) => `export * as r${index} from ${JSON.stringify(`${root}/${path}`)};`).join("\n");
    const piecePlugin = {
      name: "plexus-piece",
      setup(build) {
        build.onLoad({ filter: /.*/, namespace: NS_CORE }, async (args) => {
          const names = await exportNames(root, args.path);
          const index = needCore(args.path);
          const lines = [`const m = __core[${index}];`];
          for (const exported of names) {
            lines.push(exported === "default" ? "export default m.default;" : `export const ${exported} = m.${exported};`);
          }
          return { contents: lines.join("\n"), loader: "js" };
        });
      },
    };
    const facades = makeFacadePlugin({
      root, plan, deferred,
      importer: (rel, found) => {
        const owner = plan.owner.get(rel);
        if (owner === name) return found;
        if (owner !== undefined) return { path: rel, namespace: NS_FACADE };
        return { path: rel, namespace: NS_CORE };
      },
    });
    const result = await esbuild({
      ...options,
      entryPoints: undefined,
      stdin: { contents: entrySource, resolveDir: root, loader: "js" },
      outfile: `piece-${name}.js`,
      format: "iife", globalName: "__piece", metafile: true, banner: undefined,
      plugins: [piecePlugin, facades, ...options.plugins],
    });
    outputs[name] = { text: result.outputFiles.find((file) => file.path.endsWith(".js")).text, metafile: result.metafile };
  }
  const buildCore = async (table) => {
    const coreImports = coreList.map((path, index) => `import * as c${index} from ${JSON.stringify(`${root}/${path}`)};`).join("\n");
    const entrySource = [
      `export * from ${JSON.stringify(`${root}/${entry}`)};`,
      `export { default } from ${JSON.stringify(`${root}/${entry}`)};`,
      `import { pieceTable } from ${JSON.stringify(`${root}/${RUNTIME}`)};`,
      coreImports,
      `pieceTable(${JSON.stringify(table)}, [${coreList.map((_, index) => `c${index}`).join(",")}]);`,
    ].join("\n");
    const facades = makeFacadePlugin({
      root, plan, deferred,
      importer: (rel, found) => (plan.owner.has(rel) ? { path: rel, namespace: NS_FACADE } : found),
    });
    return esbuild({
      ...options,
      entryPoints: undefined,
      stdin: { contents: entrySource, resolveDir: root, loader: "js" },
      metafile: true,
      plugins: [facades, ...options.plugins],
    });
  };
  const textOf = (result) => result.outputFiles.find((file) => file.path.endsWith("extension.js")).text;
  const coreCode = textOf(await buildCore({}));
  const split = splitCss(css, coreCode, Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, output.text])));
  const table = {};
  for (const [name, output] of Object.entries(outputs)) {
    table[name] = {
      roots: Object.fromEntries(rootsOf[name].map((path, index) => [path, `r${index}`])),
      code: encodePiece(`${output.text}\nreturn __piece;`),
      css: split.lazy[name] ? encodePiece(split.lazy[name]) : "",
    };
  }
  const result = await buildCore(table);
  const report = {
    coreBytes: Buffer.byteLength(coreCode, "utf8"),
    pieces: Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, {
      bytes: Buffer.byteLength(output.text, "utf8"),
      stored: table[name].code.length + table[name].css.length,
      cssBytes: Buffer.byteLength(split.lazy[name] || "", "utf8"),
    }])),
  };
  return { javascript: textOf(result), css: split.eager, metafile: result.metafile, report, plan };
}
