You are a senior security and performance engineer. Security + performance only.

Repo: /Users/svyatoslavkleshchev/plexus-Diagram
Read reviews/0.4.2-2026-08-28/diff.txt and src/library.js, src/canvas.js drop/connect, src/feature.js nest stack.

Review for:
- XSS via library titles / drop payload / crumb titles into DOM (textContent vs innerHTML)
- Unbounded nest stack / library query
- Capture-phase focus/scroll listeners leaking
- Metadata writes on every name keystroke (150ms debounce) vs graph load
- parseDropPayload treating random 9-char tokens as uids

Write reviews/0.4.2-2026-08-28/review-security-perf.md with the skill format (Severity, Type security|performance). Do not implement.
