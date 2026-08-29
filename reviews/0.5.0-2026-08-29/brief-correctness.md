You are a senior engineer reviewing Plexus Diagram v0.5.0. Scope: correctness, bugs, edge cases only.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram
Read the diff at: reviews/0.5.0-2026-08-29/diff.txt
Also read src/canvas.js (connectArm, completeConnect, attachSession, Esc), src/feature.js (openNestedDiagram, openCrumb, attachViewSession), src/view.js (sessionBox).

This release:
- Two-click + drag connect; temp wire on .pxd-edges-temp; Connect tool stays on
- In-place nested boards: attachSession, NO openBlock; crumbs + Esc pop
- Section click-rename; card/section color::
- Removed caret-color CSS so Svy Beam can paint (theme measures transform scale)

Review every changed file for logic errors, unhandled edges, silent failures, missing tests.

For each issue write:

## [Short Issue Title]
**File:** path:line
**Severity:** critical | warning | suggestion
**What is wrong:**
**Why it matters:**
**What needs to change:**

If a section is clean, say so. Write the full review to reviews/0.5.0-2026-08-29/review-correctness.md now. Do not implement.
