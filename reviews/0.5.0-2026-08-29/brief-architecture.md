You are a principal engineer reviewing Plexus Diagram v0.5.0. Scope: architecture, roam-plugin-dev fit, not the raw 3700-line generated bundle.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram
Read: src/canvas.js, src/feature.js, src/view.js, src/session.js, src/metadata.js, src/model.js, src/extension.css, CHANGELOG.md, README.md.
Targeted hunks: attachSession, openNestedDiagram (no openBlock), sessionBox in view.js, connectArm / completeConnect, color:: persist, crumb row always mounted, Esc nest pop.

Battle rules that apply: 2 (echo), 5 (CSS scope), 10 (native blocks canonical), 11 (one session per unit), 13/19 (renderBlock scratch), 20 (no :harc/:diagram writes). Cleanup ownership: attachSession must not leak pull watches; nest must not fight hashchange.

Theme companion (do not require a theme commit): svy-theme measureCaretRect now applies CSS transform scale; overlay exclusion of .pxd-root was removed.

For each issue:

## [Short Issue Title]
**File:** path:line
**Severity:** critical | warning | suggestion
**What is wrong:**
**Why it matters:**
**What needs to change:**

Write reviews/0.5.0-2026-08-29/review-architecture.md now. Do not implement. Read-only.
