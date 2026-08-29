You are a senior security and performance engineer reviewing Plexus Diagram v0.5.0. Scope: security and performance only.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram
Read: reviews/0.5.0-2026-08-29/diff.txt
Also read src/canvas.js (pointer capture, connect listeners, color CSS), src/library.js if touched, src/feature.js nest attach.

Look for:
- XSS via section title / edge label / color values written into style/innerHTML
- Unbounded listeners (connectArm pointermove, pull watches on nested sessions)
- N+1 Roam writes, leaks on attachSession
- color-mix / style.background from user color ids (palette is fixed; still check)

For each issue:

## [Short Issue Title]
**File:** path:line
**Severity:** critical | warning | suggestion
**Type:** security | performance
**What is wrong:**
**Attack vector / Impact:**
**What needs to change:**

Write reviews/0.5.0-2026-08-29/review-security-perf.md now. Do not implement.
