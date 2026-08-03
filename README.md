# Roam Extension Template

A public-ready, zero-runtime-dependency starting point for a Roam Depot extension. The source is modular; the build emits the root Depot files and an identical `deploy/` directory for GitHub Pages.

## Start a new extension

1. Create a repository from this GitHub template.
2. Replace `roam-extension-template`, `Example Extension`, `example-extension`, and the package description.
3. Replace the example feature and settings while keeping the lifecycle boundary.
4. Run `npm run check` with Node.js 20 or newer.
5. Commit the generated root `extension.js`, `extension.css`, and `deploy/` artifacts.
6. Enable GitHub Pages with **GitHub Actions** as its source.

Never put API keys, graph tokens, private prompts, or graph data in source code. Store user-entered configuration with `extensionAPI.settings`; review whether a setting is suitable for graph sync before using it for sensitive credentials.

## Commands

```bash
npm run dev    # initial build, then rebuild src/ changes
npm run build  # generate root and deploy artifacts
npm test       # node:test suite
npm run scan:secrets     # fail on common committed credentials
npm run verify:generated # compare source with root/Pages artifacts
npm run check  # build, syntax check, and tests
```

There are no runtime dependencies. The sole build-time dependency is exactly pinned `esbuild`, with its complete dependency graph locked in `package-lock.json`. It bundles `src/extension.js` and legitimate relative modules into one browser ESM file while preserving the default Roam lifecycle export. Browser targeting makes unresolved packages and Node built-ins hard build failures, and an explicit build guard rejects HTTP(S) imports so the published extension is self-contained. The build emits no source map.

Run `npm ci --ignore-scripts --no-audit --no-fund` once after cloning and whenever the lock changes. The official Depot entry point, `build.sh`, performs that clean locked install itself before building, including when invoked from another working directory. CI and Pages install once and then call the npm checks directly to avoid redundant installs.

The secret scanner covers common Roam, OpenAI, Anthropic, GitHub, Google, AWS, Slack, and private-key formats. Fix a finding rather than suppressing it. For a genuinely synthetic false positive, put `secret-scan: allow RULE-ID -- REASON` on the same or immediately preceding line; the reason must contain at least eight characters and is reported by CI.

## Roam lifecycle

`src/extension.js` exports `{ onload, onunload }` as the default export, as required by Roam. `onload` also returns a cleanup callback. Both paths share one idempotent lifecycle instance, so reloads cannot leave a second active runtime.

Roam automatically removes extension-scoped command palette commands, slash commands, the settings panel, and `extension.css`. `src/lifecycle.js` also explicitly unregisters commands and owns resources Roam does not remove: pull watches, DOM nodes, listeners, observers, timeouts, and intervals. Add every new long-lived resource to this lifecycle.

The settings example follows the current Extension API contract: `get` returns `null` for an unset key, `set` persists a JSON value, and `settings.panel.create` automatically stores switch/input/select controls by row `id`.

Reference: [Roam Depot/Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api).

## Install as a Developer Extension

First run `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run build`. In the target Roam graph, open **Settings → Roam Depot**, enable **Developer mode**, then use **Developer Extensions → Load extension**.

For a local build:

1. Choose **Local folder**.
2. Select this repository root—the folder containing `README.md`, `extension.js`, and optional `extension.css`.
3. Local-folder extensions do not auto-start after a new app session because the browser requires a fresh filesystem permission. Load the folder again from Developer Extensions, or use `Ctrl-D`, then `Ctrl-R`.

For a hosted build:

1. Enable GitHub Pages with **GitHub Actions** as the repository's Pages source.
2. Choose **URL** in Roam and enter the public root URL exactly as `https://OWNER.github.io/REPOSITORY`—include `https://`, and do not append `/extension.js`.
3. Confirm that `https://OWNER.github.io/REPOSITORY/README.md` and `/extension.js` open publicly. URL extensions auto-start and are downloaded again when Roam opens or the developer extensions reload.

Developer extensions are installed **per client, not synced through the graph**. Repeat the URL installation on every desktop/browser profile or mobile client that should run it. Reload all developer extensions with `Ctrl-D`, then `Ctrl-R`, or use **Settings → Roam Depot → Developer Extensions → Reload**.

## GitHub Pages and Depot

On a push to `main`, CI builds, scans, and tests first. Both workflows then require `git diff --exit-code` for generated artifacts. Pages upload and deployment cannot run when validation or drift detection fails. The published `deploy/extension.js` and `extension.css` are byte-for-byte identical to the root artifacts used for a Depot submission.

For personal testing, add the repository's Pages URL in Roam Depot developer mode as described above. A future Depot submission should use the same reviewed source and root artifacts, with the repository pinned according to Roam Depot's current submission requirements.

## Release checklist

- Update `package.json` and `CHANGELOG.md`.
- Run `npm run check`.
- Inspect the generated diff and scan it for secrets.
- Commit source and generated artifacts together.
- Tag the release after `main` is green.
- Reload the developer extension in a disposable test graph before publishing.

## License

[MIT](LICENSE)
