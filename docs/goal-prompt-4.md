/goal Work through every open task on the Roam Svy page "Plexus Diagram" (uid yyuvKc554, titles "<title> - Plexus Diagram <ID>"), phase by phase, until each is DONE or carries a Blocked note I have seen. You are Claude Code (Opus 5.5) running inside T3 Code. You orchestrate. Grok does the building, through T3.

LANES (this run only, until 2026-10-08 23:59 Pacific; it overrides lane-fit.md, AGENTS.md, GUARDRAILS and the routing hooks for this repo):
The Grok and Cursor subscriptions end on 2026-10-08, so spend them. Claude's job: plan batches, write contracts, read diffs, run the live acceptance in Roam, commit, release, tick tasks. Grok's job: implementation, contract critique, code review, and the sibling-repo tasks.
- Delegate with the T3 MCP tool `delegate_task` (mode "async", runtimeMode "full-access", one stable clientRequestId per unit per round). Do not call grok-run.sh, cursor-run.sh, the grok CLI, or cursor-agent from Bash; T3 owns those sessions.
- Targets, from `orchestrator_capabilities` (re-read it at the start; model ids drift):
  - Implementer: `{providerInstanceId:"grok", model:"grok-4.7", options:{reasoningEffort:"high"}}`. Use "xhigh" for a unit a Grok implementer already failed once, and for contracts and plans.
  - Second implementer or reviewer: `{providerInstanceId:"cursor", model:"grok-4.7", options:{fastMode:false, reasoning_effort:"high"}}`. Cursor Fast mode is never allowed: always pass fastMode:false. `composer-2.5` (fastMode:false) is fine for small mechanical units.
  - Grok Build agent: `{providerInstanceId:"grok", model:"grok-build"}` for long multi-file units that need many tool calls.
- Keep two to four Grok tasks running whenever there is work that can run in parallel: implementers on disjoint files, a Cursor-Grok reviewer on the previous unit's diff, and sibling-repo tasks (each in its own repo). Async children wake this thread when they finish, so end your turn instead of polling.
- Fallback: if a Grok or Cursor child fails with an auth, quota or subscription error, retry that unit once on the other Grok target. If that fails too, or the date is past 2026-10-08, switch to the normal ladder (Agent sonnet-worker; claude-run.sh --tough for a twice-failed unit) and tell me.
- Claude subagents are fine for read-only search (Explore). Do not hand implementation to general-purpose agents.

WORK ORDERS FOR GROK CHILDREN:
A delegated child sees only its prompt. Write each unit as a file under /tmp/wo/pxd4/<ID>.wo.md and pass "Read and execute /tmp/wo/pxd4/<ID>.wo.md". Every work order states:
- repo path, branch main, the files it owns (and "do not edit any other file")
- the task text from docs/roadmap-3.md (ID section) plus the contract excerpt
- tests to add (node --test, fake-DOM helpers like the existing ones), and to run only `node --test test/<its files>`, never `npm run build` (the parent builds once after integration, because concurrent builds overwrite extension.js)
- "Do not commit, push, tag, deploy, stash, checkout or reset. Do not touch Roam or CDP. Leave changes in the working tree."
- the hard rules below that apply
- what to report: files changed, tests added, anything unsure
Sibling-repo units (ECO-8, ECO-9, TSK-2) run in their own repo and may run that repo's full check, but still do not commit; you commit and deploy them.

READ FIRST:
- Svy page "Plexus Diagram": each TODO's BT_attrNotes children are the spec (Roam model, Design, Build tips, Acceptance, Out of scope, Revisit when). Follow Acceptance literally.
- ~/plexus-Diagram/docs/roadmap-3.md (all phases P17-P25, task text in full, Facts section), docs/roadmap.md sections 2-4 and 8, README.md, docs/spec-plexus-2.0.md, docs/api-plexus-2.0.md, tools/live/README.md.
- ~/.claude/projects/-Users-svyatoslavkleshchev-plexus-Diagram/memory/MEMORY.md (live facts, traps, past root causes).
- Skills roam-plugin-dev and roam-task.

ORDER:
1. P23 (speed: PERF-4..9, REL-1) first. PERF-4, PERF-9 and REL-1 ship as 2.13.2 before this run if their tasks are DONE; otherwise finish them.
2. P24 (reliability: REL-2..5, ECO-8, ECO-9). Build REL-2's smoke suite early: every later batch runs it.
3. The open older tasks: TSK-2..5, NAV-3, MEM-6, MEM-7, MEM-8 (check its Revisit when).
4. P25 (HEP-1..4).
5. P22 last (POL-1..5, DOC-1, DOC-2) and release 3.0.0.
Within a phase, order by Depends then Effort. Post the ordered batch list with target versions in this thread, then start building right away. Stop and ask only where a task needs a choice its notes do not settle.

PER BATCH:
a. Measure the unknowns live first (Build tips name them). Record in docs/roadmap.md section 8.
b. Contract in docs/batch-4-N.md: tasks, files per implementer, data model, test names, acceptance list.
c. Critic pass: delegate the contract to the Cursor Grok target ("what breaks in Roam?"), then fix the contract.
d. Delegate implementers in parallel on disjoint files. When they finish: read every diff yourself, integrate, `npm run build`, `npm run check`.
e. Review: delegate the batch diff (`git diff`) to a Grok reviewer with the contract. Verify each finding yourself before fixing; send real fixes back to a Grok implementer as a new round with the finding text.
f. Live acceptance (you, not a child): every Acceptance step of every task, trusted CDP input, dark and light, screenshots in .live/shots/<ID>-*.png that you look at. Then tools/live/smoke.mjs once it exists, and tools/live/perf-gate.mjs once it exists.
g. Standing gate: typing bench, unload leaves 0 .pxd-* nodes, no Plexus console errors.
h. Release: bump, CHANGELOG, README for user-visible changes, commit, annotated tag on the final commit, push main and that tag only, wait for Pages (gh run list -R Svyk/plexus-diagram --limit 3), cmp the published extension.js/.css against the build.
i. Tick: docs/roadmap.md row and section 8 numbers; Svy task writes as below.
j. Append a progress line to .live/run-4.md (batch, version, sha, tasks, which Grok targets did what, open issues). After a context compaction, read .live/run-4.md and `git log` first and continue from there.

SVY WRITES (only these):
On the TODO blocks of the page "Plexus Diagram" only:
- Done in place: python3 ~/.claude/scripts/roam_tasks.py --done <uid>, only after its live test passed.
- Append children under that task's BT_attrNotes via ~/.claude/scripts/roam_writer.py append_block: "**Shipped**: vX.Y.Z (`sha`) · <one line>", "**Expected behavior**:" (children "When I <do X>, <Y happens>"), "**Testing**:" (children: action, what you saw, the number), "**Limits**:" if any. Read back with get_block.
- If a task is impossible or wrong: a "**Blocked**:" child with reason and evidence; do not mark it done; tell me.
Never touch BT_attr* blocks, never create pages or tasks in Svy, never touch other Svy pages.

HARD RULES:
- Repo ~/plexus-Diagram (remote Svyk/plexus-diagram). ~/system-setup/plexus-Diagram is a backup mirror: never edit it. Sibling repos (~/roam-plexus, ~/roam-compass, ~/Roam-Task-Status-Tags) change only for tasks that name them; additive public APIs only; bump, CHANGELOG, push, Pages deploy and cmp; record their sha in the Shipped line. ~/better-tasks is never changed.
- docs/roadmap.md section 3 rules: add, never take away; Roam data canonical, props merged on write; never write :diagram/* or BT_attr*; no writes on open, pan, zoom, select; at most 45 writes per user action; never stop mouseup in a renderBlock editor; window-capture keys; no setPointerCapture; exactly two palette entries; zero runtime deps; theme from bp3-dark or measured luminance, borders carry meaning in dark; tests for every module.
- Live testing only in the Readwisenotes graph on "Plexus Diagram/Test Lab" (and fixture pages a task creates, ledgered). Re-list CDP targets on :9223 before each run and match by exact id or title. Dev-load only into a Readwisenotes window that already has window.__pxdLive or no installed Plexus. Never inject into Svy, never into "plx typing bench". Ledger every uid you create and clean up after each batch. The Readwisenotes window keeps about 141 daily-page windows in its right sidebar: do not close or remove them; account for them when measuring sidebar cost (A/B loaded vs unloaded).
- Profiling: attribute by exact script URL. Other extensions also load from blob: URLs, so "blob:" is not Plexus.
- Double-click on empty canvas creates a card. Hit-test with elementFromPoint before any double-click and read back the target block after typing.
- CDP key events do not trigger Electron clipboard: copy/paste goes under Limits for me to check by hand.
- Commits: git -C <repo> -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com" commit. New commits only, never --amend, never --no-verify. Check the author of every commit, including anything a child committed by mistake (soft-reset and recommit under the right author).
- Stop and ask before anything irreversible, any Svy write beyond the above, and any design choice the notes do not settle.

Done means: every task on "Plexus Diagram" is DONE with Shipped / Expected behavior / Testing children, or open with a Blocked child I have seen. Finish with: batches, versions, tasks done and blocked, typing and perf-gate numbers per batch, and how the work split between Grok, Cursor-Grok and Claude.
