You are a senior engineer. Correctness, bugs, and edge cases only.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram
Read the diff at: reviews/0.4.2-2026-08-28/diff.txt
Also git show da46011 --stat and read src/canvas.js, src/feature.js, src/library.js, src/extension.css around the changed regions.

Focus:
- connect-to-empty addCard+addEdge race / missing uid
- nest stack push/pop vs hashchange
- library portal leak on unload
- fullscreenInsets right sidebar 8px flush
- focus/scroll capture stealing Roam focus
- parseDiagramTitle / name-this-board debounce writes

Write reviews/0.4.2-2026-08-28/review-correctness.md with:

## [Title]
**File:** path:line
**Severity:** critical | warning | suggestion
**What is wrong:**
**Why it matters:**
**What needs to change:**

If a section is clean, say so. Do not implement.
