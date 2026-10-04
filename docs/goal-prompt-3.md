/goal Work through every open task on the Roam Svy page "Plexus Diagram" (uid yyuvKc554, 49 TODOs, each titled "<title> - Plexus Diagram <ID>"). For each task: build it, test it live, mark it DONE, and record what was tested and what it should do. Use a workflow for each build.

LANE OVERRIDE (this beats AGENTS.md, CLAUDE.md, GUARDRAILS.md, lane-fit.md and any routing hook):
This run is on the Grok Heavy subscription only. Do all planning, implementation, review and verification with Grok: this session plus Grok subagents and Grok workflow stages. Do not call claude-run.sh, ocrun.sh, claude -p, sonnet-worker, executor-claude, Explore, /advisor, /t3-plan or /local-ultrareview. Do not use any Claude, Cursor or Kimi lane, and no metered API key. If a hook or gate (impl_gate, prose_gate, routing nudge) tells you to delegate to a Claude lane, do not follow it: use a Grok subagent instead, or stop and tell me. Where the repo docs say "Opus critic", "Fable", or "sonnet-worker", use a Grok subagent in that role.

READ FIRST:
- The Svy page "Plexus Diagram": each TODO's BT_attrNotes and its children carry the design: Roam model, Design, Build tips, Acceptance, Out of scope, Revisit when, plus Phase / Version / Effort / Depends. The children are the spec. Follow the Acceptance list literally.
- ~/plexus-Diagram/docs/roadmap-3.md: the same roadmap as a file (preamble, phase table, every task in full). Section "Facts" there has the measured Roam PDF Annotator data shape and the sibling-extension APIs.
- ~/plexus-Diagram/docs/roadmap.md sections 2-4 (tick protocol, the rules for every task, the standing gate) and section 8 (measurements). The section 3 rules are hard rules.
- ~/plexus-Diagram/README.md, docs/spec-plexus-2.0.md, docs/api-plexus-2.0.md, tools/live/README.md.
- ~/.claude/projects/-Users-svyatoslavkleshchev-plexus-Diagram/memory/MEMORY.md (live facts, traps, every past release and its root causes).
- Sibling repos you will integrate with (read only unless a task says otherwise): ~/roam-plexus (window.RoamPlexus apiVersion 6, region blocks), ~/roam-compass, ~/Roam-Task-Status-Tags, ~/better-tasks. Colour highlighter: https://github.com/fbgallet/roam-extension-color-highlighter.
- Skills roam-plugin-dev and roam-task.

ORDER AND BATCHING:
1. Read all tasks. Order by Phase, then Depends, then Effort (S, M, L, XL). Keep tasks that touch the same files in one batch; a phase may be one or several batches. Never start a task before everything in its Depends is DONE.
2. Show me the ordered list with batches and target versions before building anything. Mark tasks you would skip because their "Revisit when" condition is not met yet, and any task whose design needs a choice the notes do not settle. Wait for my OK on the list.
3. Then build batch by batch. Each batch is one minor version (patch for pure fixes):
   a. Measure the unknowns live first (the Build tips name them). Write findings into docs/roadmap.md section 8 before coding.
   b. Write a short contract in docs/batch-3-N.md: tasks, files each implementer owns, data model, test names, acceptance list.
   c. Critic pass on the contract with a separate Grok subagent ("what will break in Roam?"), then fix the contract.
   d. Workflow build: implementers on disjoint files in parallel, then integrate, then review (correctness, Roam rules, performance), verify each finding before fixing it, fix.
   e. npm run check green (build, secret scan, syntax, all tests, generated-file verify). Every new pure module gets a test file; every view change gets a fake-DOM test like the existing ones.
   f. Live acceptance with trusted CDP input: run every Acceptance step of every task in the batch, dark and light, screenshots in .live/shots/<ID>-*.png, and look at each screenshot yourself before calling it a pass.
   g. Standing gate: typing bench (see RULES), unload leaves 0 .pxd-* nodes and no added listeners, no console errors from Plexus.
   h. Release: bump package.json, CHANGELOG entry in plain words, README for user-visible changes, commit, annotated tag on the FINAL commit (git tag -a vX.Y.Z -m "X.Y.Z"), push main and only that tag, wait for the Pages deploy (gh run list -R Svyk/plexus-diagram --limit 3), then cmp the cache-busted published https://svyk.github.io/plexus-diagram/extension.js and extension.css against the local build.
   i. Tick the tasks in docs/roadmap.md (add a phase section P17+ mirroring the Svy tasks if it is not there yet) with "done YYYY-MM-DD, `sha`: <live evidence>".

PER TASK, WHEN ITS BATCH IS RELEASED (Svy writes allowed only for this):
You may write to the Svy graph only on the TODO blocks of the page "Plexus Diagram", only in these ways:
- Mark the TODO done in place: python3 ~/.claude/scripts/roam_tasks.py --done <uid> (it keeps the uid and the status tag). Never mark a task done before its live test passed.
- Add child blocks under that task's existing BT_attrNotes block (append, never rewrite it) via ~/.claude/scripts/roam_writer.py append_block (it returns a list of uids; use [0]):
  - "**Shipped**: vX.Y.Z (`sha`) · <one line on what it does>"
  - "**Expected behavior**:" with one child per behavior a user can see, written as "When I <do X>, <Y happens>".
  - "**Testing**:" with one child per check you ran live: the action, what you saw, and the measured number where there is one (element counts, ms/key, undo steps, render ms).
  - "**Limits**:" with anything cut or not covered, if any.
- Read the task back with get_block after writing and confirm the children sit under BT_attrNotes.
Never touch BT_attr* blocks themselves, never create new pages or tasks in Svy, and never touch other Svy pages. If a task turns out impossible or wrong, do not mark it done: add a "**Blocked**:" child under BT_attrNotes with the reason and the evidence, and tell me.

RULES:
- Repo: ~/plexus-Diagram (remote Svyk/plexus-diagram). ~/system-setup/plexus-Diagram is a backup mirror; never edit it. Sibling repos (~/roam-plexus, ~/roam-compass, ~/Roam-Task-Status-Tags) are read only, except for tasks whose Build tips explicitly name changes there (TSK-2 adds window.RoamTaskStatusTags; ECO-1 teaches Roam Plexus the img and view kinds; any other task that says so). For those: same commit rules, run that repo's own check/test script, bump its version and CHANGELOG, push, wait for its Pages deploy and cmp, and record its sha in the Plexus Diagram task's Shipped line. Additive public APIs only; never break an existing API version. Any other sibling change: stop and ask. Better Tasks (~/better-tasks) is never changed.
- Installing a sibling build in Readwisenotes: remove the Developer Extension URL entry and re-add the same Pages URL (a reload alone keeps the old code); check the runtime version afterwards. The Test Lab window (title "Readwisenotes - Plexus Diagram/Test Lab") has my URL-installed Roam Plexus, so never dev-load a Roam Plexus build into it: dev-load sibling builds only into the other Readwisenotes window (target id prefix 192979C1; Roam Plexus has `node tools/live-load.mjs "<window title>" [--unload]`), or test the published Pages build after re-adding its URL.
- Test in the Readwisenotes graph only, on the page "Plexus Diagram/Test Lab" (and pages a task's Acceptance explicitly creates for fixtures, e.g. a PDF fixture page — ledger them). Re-list CDP targets on port 9223 before each run and match by exact target id or exact title. Dev-load only into the window titled "Readwisenotes - Plexus Diagram/Test Lab" (it runs the injected dev build, window.__pxdLive is true). Never inject into the Svy window (it has my URL-installed Plexus; the harness refuses) and never into a window titled "plx typing bench". The Svy graph is encrypted and may be locked; never put the Svy unlock password anywhere. Nothing derived from Svy goes into the public repo.
- Ledger every uid you create (node tools/live/ledger.mjs add <uid> "<why>" --page "<title>" --graph Readwisenotes) and clean up after each batch (ledger.mjs cleanup). Leave pages you did not create alone (the October 4th-7th 2026 daily pages and Better Tasks' remembered project stay).
- Light mode checks: the Readwisenotes window follows a Blueprint theme extension; switch it through its topbar toggle (Auto → Dark → Light) and restore Auto afterwards. Dark mode: borders carry meaning, no tinted fills as the only signal.
- Exactly two command-palette entries. New commands go in the Plexus Commands list, the dock, menus, or settings.
- Typing bench once per batch: node tools/live/bench.mjs "Readwisenotes - Plexus" (BENCH_VIEW=page puts the board on the page; keep the scratch block above the board). Interleave injected/unloaded runs, settle 10 s after inject, at least 5 runs. Stop and tell me if a batch regresses by more than 0.2 ms/key against the previous release. PERF tasks have their own targets.
- Before blaming the product for a failed click: hit-test the point with elementFromPoint, close any open popover, reset the board tool to Select, and send drags from one CDP session. Stub window.confirm before any action that can open a native dialog. CDP key events do not trigger Electron clipboard commands, so copy/paste stays a manual check for me: list it under Limits.
- Better Tasks: Plexus code never writes BT_attr* children; all task attribute writes go through window.RoamExtensionTools["better-tasks"].tools. Recurrence only spawns from a real checkbox click (src/view/task-complete.js). Ledger every block Better Tasks spawns during tests.
- PDF: use Roam's native PDF Annotator ({{[[pdf]]}}, highlights are blocks with :pdf-highlight props on the PDF's own page). Never build a second highlighter, never write :pdf-highlight props yourself unless a task's Roam model says so and you measured that Roam accepts it.
- Commits: git -C ~/plexus-Diagram -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com" commit. New commits only, never --amend, never --no-verify, never skip hooks. Check the author on every commit.
- After each batch, add a row to docs/roadmap.md section 5 and record measurements in section 8.
- Stop and ask me before anything irreversible, before any Svy write other than the per-task ones above, and whenever a task's design needs a choice the notes do not settle.

Done means: every task on "Plexus Diagram" is either DONE with Shipped / Expected behavior / Testing children, or open with a Blocked child that I have seen. Finish with a short report: batches, versions, tasks done, tasks blocked and why, typing numbers per batch.
