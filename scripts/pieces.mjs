// Splits the bundle into a start-up core and pieces of rarely used code. Roam Depot publishes only
// extension.js and extension.css, and remote code is off the table, so a piece travels inside
// extension.js as deflated text and is evaluated on its first call (src/piece-loader.js).
//
// PIECES names root modules. Every other module that only those roots reach goes with them. Core code
// keeps its imports and calls: each root import is swapped for a generated module of forwarders, so
// no call site changes and a call stays synchronous. A piece reaches core modules through a table
// the core fills in at start, so each module exists once.
import { build as esbuild } from "esbuild";
import { deflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const NS_FACADE = "plexus-facade";
const NS_CORE = "plexus-core";
const NS_ENTRY = "plexus-entry";
const RUNTIME = "src/piece-loader.js";

export const PIECES = {
  changelog: ["src/changelog-text.js"],
};

// Exports that build a view at board mount. See pieceDefer in src/piece-loader.js.
export const DEFERRED = {};

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
        lines.push(`export const ${local} = (...args) => pieceDefer(() => pieceLoad(${JSON.stringify(piece)}, ${JSON.stringify(path)}).${name}(...args), ${JSON.stringify(idle)}${process.env.PIECE_TRACE ? `, ${JSON.stringify(name)}` : ""});`);
        seen.push(name);
        continue;
      }
      lines.push(`export ${name === "default" ? "default " : "const " + local + " = "}function (...args) { return pieceLoad(${JSON.stringify(piece)}, ${JSON.stringify(path)}${process.env.PIECE_TRACE ? `, ${JSON.stringify(name)}` : ""}).${name}.apply(this, args); };`);
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

function encodePiece(text) {
  return deflateRawSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64");
}

export async function buildPieces({ root, options, pieces = PIECES, deferred = DEFERRED, entry = "src/extension.js", cssFor = () => "" }) {
  const scan = await esbuild({ ...options, metafile: true, minify: false, banner: undefined });
  const plan = assignModules(scan.metafile, pieces, entry);
  const coreList = [];
  const coreIndex = new Map();
  const needCore = (rel) => {
    if (!coreIndex.has(rel)) { coreIndex.set(rel, coreList.length); coreList.push(rel); }
    return coreIndex.get(rel);
  };
  const outputs = {};
  const rootsOf = {};
    for (const name of Object.keys(pieces)) {
    const roots = [...plan.roots].filter(([, owner]) => owner === name).map(([path]) => path);
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
  const table = {};
  for (const [name, output] of Object.entries(outputs)) {
    table[name] = { roots: Object.fromEntries(rootsOf[name].map((path, index) => [path, `r${index}`])), code: encodePiece(`${output.text}\nreturn __piece;`), css: cssFor(name) };
  }
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
    importer: (rel, found) => {
      if (plan.owner.has(rel)) return { path: rel, namespace: NS_FACADE };
      return found;
    },
  });
  const result = await esbuild({
    ...options,
    entryPoints: undefined,
    stdin: { contents: entrySource, resolveDir: root, loader: "js" },
    metafile: true,
    plugins: [facades, ...options.plugins],
  });
  return { result, plan, outputs, table };
}
