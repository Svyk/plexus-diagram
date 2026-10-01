You are a principal engineer. Architecture and roam-plugin-dev fit only. Do NOT read the whole 50KB diff — read this brief and the named files.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram commit da46011 (v0.4.2).

Files to read (not the generated extension.js):
- src/canvas.js — parseDiagramTitle, nest stack UI, connect-to-empty, fullscreenInsets, library not here
- src/feature.js — nestStack push, openNestedDiagram, hashchange pop
- src/library.js — document.body portal
- src/extension.css — caret-color !important under .pxd-root (Svy Beam opt-out)
- Battle rules: lifecycle dispose of listeners/observers; CSS scoped under .pxd-root except the body-mounted library portal; native blocks canonical; scratch-host still used for card edit.

Review:
- nest stack as module global vs per-session
- library portal on body vs lifecycle.node cleanup
- CSS !important vs theme contract (rule 17)
- connect-to-empty creating cards as diagram children (good) vs metadata-only edges (known)

Write reviews/0.4.2-2026-08-28/review-architecture.md. Severity critical|warning|suggestion. Do not implement. Read-only.
