# Stress suite

Dev-only Node 20+ tools that drive Roam Desktop over CDP (`http://127.0.0.1:9223`) to measure how fast the Plexus stress board feels. No npm dependencies. Nothing here is bundled or imported by `src/`.

The board is block `KT_KHnsXe` in the `Readwisenotes` graph (about 1500 items, nested chain `3g8aFy9ZW,_pwUcy2_7`).

## Safety rules

- **Bench window.** Only a `Readwisenotes` window marked `sessionStorage["pxd-bench"] === "1"` may be reloaded, navigated, sent input, or used to write Roam data.
- **Svy's own window** runs the passive recorder (`window.__pxdRec`). `record.mjs` may install observers in it and read it. Nothing else touches it. A window whose title starts with `Svy` is never touched at all.
- **Lock file** `~/wo/bench-<first 8 chars of target id>.lock` (`<session> <ISO time> pid=<pid>`). A live lock held by another process stops the run. A dead or six-hour-old lock is replaced. The lock is released between `run.mjs` calls and between `ab.mjs` arms, never inside one.
- **Input.** Every press is hit-tested against the DOM and the world rects first (a card without a shell is still pressable). Clicks are held 120 ms.
- **Camera.** The key `plexus-diagram:vp:Readwisenotes:KT_KHnsXe` is shared by both windows. The runner aims the camera before a reload and leaves the bench view at the saved camera when it ends. It puts back the newest value Svy's window wrote (or the saved one) on every exit.
- **Sidebar.** A right sidebar left open is closed before the next scenario.
- **CDP.** `Page.enable` is sent so the probe installs on reload. Script sources are never pulled over CDP (large replies close the socket). `window.confirm` is stubbed to answer "no" during a run and restored on exit.
- **Scratch section and cleanup.** Edit scenarios write only inside a scratch section far from real cards. Every run that edits prints a `leftovers {...}` line at its end. `run.mjs --cleanup` removes what is left and prints one `cleanup {...}` line with `markerBlocks`, `ledgerLeft` and `clean`; it exits 0 only when `clean` is true.
- **Write pacing.** At most 1200 Roam writes a minute (the app's limit is 1500). A leave-and-return scenario waits 40 s after the last one.
- **Edits sync.** Edits made in the bench window sync to every other window of the graph and cost each of them a freeze on 3.39.1 (Svy's window included). Keep edit passes few.

## Set-up

1. In Roam Desktop open a second `Readwisenotes` window (not Svy's) and make it visible and on screen (refresh rate 20 Hz or more).
2. Mark it. In that window's console: `sessionStorage["pxd-bench"] = "1"`.
3. Check: `curl -s localhost:9223/json | grep -i readwisenotes`. If several windows are marked, pass `--target <idPrefix>` or set `STRESS_TARGET`.

Results go to `OUT_DIR`, which is `$STRESS_OUT` or `~/wo/pxd-fast`:

| Path | Content |
|---|---|
| `results.jsonl` | one JSON object per run, appended |
| `traces/` | gzip Chrome traces of traced runs |
| `state/` | saved camera and similar |
| `noise.jsonl` | A/A noise floors |
| `ab.jsonl` | A/B tables |
| `builds/` | frozen copies of builds (`extension.js` + `extension.css`) |

## Typical round

```bash
# 1. record real use in Svy's window, then analyse it
node tools/live/stress/record.mjs start <svyId>
node tools/live/stress/record.mjs dump  <svyId> ~/wo/pxd-fast/rec/real-2.json --stop
node tools/live/stress/analyse.mjs ~/wo/pxd-fast/rec/real-2.json --json ~/wo/pxd-fast/rec/real-2.analysis.json

# 2. baseline on a frozen build
node tools/live/stress/run.mjs --build ~/wo/pxd-fast/builds/3.39.1 --n 3 --label base

# 3. traced pass (no timed repeats), then readable profiles from an unminified build
node tools/live/stress/run.mjs --build ~/wo/pxd-fast/builds/3.39.1 --trace-only --label base
node tools/live/stress/devbuild.mjs . ~/wo/pxd-fast/builds/dev
node tools/live/stress/run.mjs --build ~/wo/pxd-fast/builds/dev --trace-only --label dev

# 4. noise floor, then the comparison
node tools/live/stress/ab.mjs --aa --a ~/wo/pxd-fast/builds/3.39.1 --group move --label aa1
node tools/live/stress/ab.mjs --a ~/wo/pxd-fast/builds/3.39.1 --b deploy --group move --label ab1

# 5. report
node tools/live/stress/report.mjs --label base --dev-label dev --rec rec/real-2.analysis.json --findings round-findings.jsonl --notes notes.jsonl --out ~/wo/pxd-fast/round.md
```

## Commands

Always pass `--build <dir>` for numbers you mean to keep: the bench window may be running another task's build. Use a frozen copy such as `~/wo/pxd-fast/builds/3.39.1`.

```bash
# recorder (passive, Svy's window)
node tools/live/stress/record.mjs start|status|stop <idPrefix>
node tools/live/stress/record.mjs dump <idPrefix> <out.json> [--stop]

# recording -> stalls, owners, gestures, presses, hover, reproduce block
node tools/live/stress/analyse.mjs <dump.json> [--wheel <recw.json>] [--json <out.json>] [--top 25]
node tools/live/stress/analyse.mjs --selftest

# suite
node tools/live/stress/run.mjs --list
node tools/live/stress/run.mjs --build <dir> --quick
node tools/live/stress/run.mjs --build <dir> --group move --n 5 --label base
node tools/live/stress/run.mjs --build <dir> --scenario zoom-btn,fit --n 3 --trace
node tools/live/stress/run.mjs --label base --reanalyse
node tools/live/stress/run.mjs --cleanup

# unminified build for readable profiles (its timings are not baselines)
node tools/live/stress/devbuild.mjs <repoRoot> <outDir>

# two builds, interleaved
node tools/live/stress/ab.mjs --aa --a <dir> --scenario zoom-btn --label aa1
node tools/live/stress/ab.mjs --a <dirA> --b <dirB> --scenario zoom-btn --label ab1

# report
node tools/live/stress/report.mjs --label base --out round.md

# traces and bundles
node tools/live/stress/lib/trace-analyse.mjs <file.json.gz> [--json]
node tools/live/stress/lib/whereis.mjs <bundle.js> <pos> [--line N] [--src src] [--context 400]
```

`run.mjs` flags:

| Flag | Meaning |
|---|---|
| `--group a,b` / `--scenario a,b` | what to run (groups: move, open, build, type, idle) |
| `--n 3` | timed repeats |
| `--label base` | label written on every line |
| `--build <dir>` | serve that build (`extension.js` + `extension.css`) by Fetch interception and prove it was served |
| `--trace` | one extra traced pass after the timed ones |
| `--trace-only` | the traced pass only, no timed repeats |
| `--reanalyse` | re-read the trace files of the label and append `reanalysed: true` lines |
| `--selectors` | selector stats in traces |
| `--quick` | n 1, short variants |
| `--soak-min 30` | length of the soak |
| `--target <idPrefix>`, `--out <dir>` | window and output folder |
| `--inline` | stay out of fullscreen |
| `--chain a,b` | nested-board uid chain |
| `--timeout <ms>` | per-scenario limit (default 240000) |
| `--keep-going` | continue after two recovery failures |
| `--cleanup` | remove leftovers of edit scenarios (see Safety) |
| `--list`, `--dry` | print scenarios or the plan; never connect |

Heavy scenarios (`idle-2min`, `soak`) run only when named.

Measured durations on the stress board:

| Run | About |
|---|---|
| `--quick` (40 scenarios) | 7.5 min (move 2, open 2, build 2, type 1, idle 0.5) |
| full pass, no `--quick` | 10 min |
| `--trace-only`, everything | 10 min |
| soak | 30 min |
| A/A, 9 scenarios, n 5 | 30 min |

`ab.mjs` runs `n` rounds (at least 5 unless `--force`). In even rounds the order is A then B, in odd rounds B then A. Each arm is one `run.mjs` call with `--build <dir> --n 1 --label <label>:<arm>`. It waits 40 s between arms (`--wait <s>`). `--aa` serves the same build as arms `A1` and `A2` and appends one line per scenario and metric to `noise.jsonl`. An A/B run reads the newest floor for each scenario and metric from there; a difference is only called better when it is larger than the floor. Lower is better for every metric. Metrics: `ttnp`, `stalls.total`, `stalls.worst`, `stalls.n`, `frames.max`, `content.live.p95`, `long.total`, plus numeric leaves under a scenario's `extra.metrics`.

## Report

`report.mjs` flags: `--label`, `--out`, `--rec <analysis.json>`, `--findings <jsonl>`, `--notes <jsonl>`, `--dev-label dev`, `--title`, `--write-budgets`, `--selftest`. Paths are relative to `OUT_DIR` unless absolute.

- `--findings`: JSON lines `{rank, title, cost, owner, evidence[], fix, code[], belongs}`. Each evidence entry starts with a path under `OUT_DIR` (one `*` per segment); the report checks the files and warns on stderr about missing ones.
- `--notes`: JSON lines `{title, text}`, printed as the last section.
- `--dev-label`: label of the traced runs on the unminified build (default `dev`).
- `--write-budgets`: for every scenario of the label, sets `ttnp`, `stalls.total` and `stalls.worst` limits in `budgets.json` to the baseline median rounded up to the next 10. It only tightens.

| Section | Holds |
|---|---|
| title line | date, version, window, build sha, run ids |
| Quick check | commands a verifier can run, what they print, how long |
| Baseline | per group: runs, ok / skipped / failed, time to next paint, stalls, frames, card delays, owner split |
| Steps | per-step tables (bands, presses, fast clicks, hover, tail, keys, typing) |
| Where the time goes | newest trace per scenario: ms and shares of script, style, layout, paint, gc |
| Hot functions | top functions from the `--dev-label` traces |
| Stall sources | stalls grouped by their biggest script, top 25 |
| Bench against the recording | presses, hover, tail and session totals beside the recording |
| Ranked top 10 | the findings file, with the evidence file check |
| Roam and other extensions | time inside stalls for every owner except Plexus |
| Noise floor | newest A/A line per scenario and metric |
| Budgets | goals and per-scenario limits against the baseline |
| Notes and limits | the notes file |

## Scenarios

Names and titles are copied from `run.mjs --list`.

| Group | Scenario | Title |
|---|---|---|
| move | `zoom-btn` | Rail zoom out x13 then zoom in x13, one click at a time |
| move | `drag-pan-reading` | Drag the background 370 px at 107% zoom |
| move | `drag-pan-small` | Drag the background 370 px at 63% zoom |
| move | `drag-pan-overview` | Drag the background 370 px at 30% zoom |
| move | `drag-pan-map` | Drag the background 370 px at 12% zoom |
| move | `click-empty` | Click empty background (107%, 63%, 30%) |
| move | `click-item` | Click a card to select it, click away |
| move | `click-edge` | Click an arrow to select it |
| move | `hover-sweep` | Move the pointer across the board, no button |
| move | `wheel-zoom` | Cmd+wheel notches in and out at 107% |
| move | `wheel-pan` | Plain wheel pan at 63% |
| move | `trackpad` | Trackpad-style pinch and flick at 107% |
| move | `fit` | Fit view, then back to 107% |
| move | `replay-nav` | Replay the recorded session's zoom clicks, drags and wheels |
| open | `reload` | Cold reload of the board page: title, paint, live, quiet |
| open | `open-daily` | Open the board page from Daily Notes |
| open | `first-pan` | Background drag-pan 300 ms after the board is live |
| open | `nested-enter` | Enter the nested board chain through the cards' open buttons |
| open | `crumb-back` | Crumb back to the stress board from a nested board |
| open | `fullscreen-out` | Leave fullscreen |
| open | `fullscreen-in` | Enter fullscreen |
| open | `sidebar-open` | Open the board in the right sidebar |
| build | `build-setup` | Create the scratch section (PXD-BENCH, far right of the board) |
| build | `add-card` | Double-click empty scratch background, type a card |
| build | `move-card` | Drag the new card 260 px |
| build | `resize-card` | Drag the card's corner grip |
| build | `connect` | Drag from the card's right port to a second card |
| build | `undo-redo` | Cmd+Z then Cmd+Shift+Z on the connection |
| build | `delete-card` | Select the second card and press Delete |
| build | `paste-20` | Paste 20 lines of text onto the board |
| build | `api-create-50` | Create a 10 x 5 grid of 50 cards by API |
| build | `marquee` | Shift+drag a selection box around the grid |
| build | `move-50` | Drag the 50 selected cards down |
| build | `move-section` | Drag the scratch section by its title |
| build | `select-all` | Cmd+A then Escape |
| build | `build-cleanup` | Delete the scratch section and prove the board is as it was |
| type | `type-card` | Type 200 characters into a card on the scratch section |
| type | `type-block` | Type 200 characters into a plain Roam block with the board mounted |
| type | `search-type` | Type a search into Find on board |
| idle | `idle-2min` | Two minutes with no input: stalls and frames at rest (heavy) |
| idle | `follow-refresh` | Follow source refresh while idle |
| idle | `soak` | 30 minute soak: pans, zoom clicks, idle; heap, nodes, listeners, stalls (heavy) |

## Result line

One JSON object per line in `results.jsonl`:

`run` (id of the run), `at`, `label`, `build {dir, sha}` (`installed` and `null` when no `--build`), `version`, `group`, `scenario`, `i` and `n` (repeat number and count), `traced`, `secs` (wall time of the scenario), `window {id, inner, dpr, vis, hz}`, `load` (machine load average), `ctx {board, zoom0, zoom1, lod0, lod1, items, camera, fullscreen, size}`, `stalls {n, total, worst, list}`, `long {n, total, worst}`, `ttnp`, `frames {n, p50, p95, p99, max, over34, over50, over100}`, `input {n, events}`, `content {...}`, `owner {plexus, roam, other, forced, render, unattributed}`, `plexus {longTasks, slowMounts, paintAudit, bgOverruns}`, `extra` (scenario-specific), `skip` (reason), `err` (message).

Traced lines (`traced: true`) add `trace {file, ms, script, style, layout, paint, gc, other, idle, hitTest, restyled, recalcs, layouts, forcedMs, tasks, profile {samples, sampledMs, mainTidMatched}, functions {self, plexus}, names, plexusUrl}`. `reanalysed: true` marks a copy appended later by `--reanalyse`; the report uses the newest line per scenario.

## How the numbers are measured

- **Stall** is a long animation frame (LoAF) of 50 ms or more. `stalls.total` is the sum of their durations, `stalls.worst` the longest. Each stall lists its scripts (url, function, invoker, position in the bundle) and its render and style-and-layout time.
- **Time to next paint (`ttnp`)** is the Event Timing duration of the input (press to the frame that paints after it). When the scenario cannot get an Event Timing row it uses the frame-after-action proxy. Rows under 16 ms do not exist, so a missing row counts as 12 ms.
- **Card states.** Each card in view is `missing` (no shell), `empty` (shell without content), `preview` (static preview rows) or `live` (real content). **Readable** delay is the time from entering view until the card is preview or live; **live** delay until it is live. `content.readable` and `content.live` give n, p50, p95 and max of those delays.
- **Owner split.** From LoAF script attribution each stall's script time goes to Plexus, Roam, or another extension (named by reading the head of the blob script). `render` is style and layout inside stalls, `unattributed` is what no script or render time explains. A traced run gives a second split from the Chrome trace: script by owner, style, layout, paint, gc, other, elements restyled, forced style and layout.
- Timed runs are never traced. Traced lines are not used for timings; the sampled CPU profile in them shows which functions carry a scenario.

## Adding a scenario

1. Add an entry to the `scenarios` array of a module in `scenarios/` (`{ name, title, run, heavy?, leaves?, needs? }`) or create a module that exports `group` and `scenarios` and add its name to `SCENARIO_FILES` in `run.mjs`.
2. `run(ctx)` returns `{ summary, extra, ttnp, skip }`. Use `ctx.probe.arm()` and `take()` around the action, `ctx.input` for input, `ctx.show(ctx.at(zoom))` to place the camera. Put per-step numbers in `extra`; the report prints `clickByBand`, `downByBand`, `press`, `release`, `hover`, `presses`, `fast`, `tail`, `keys` and `typing` as tables. Numbers that an A/B run should compare go under `extra.metrics`.
3. Mark it `heavy: true` if it takes more than a few minutes, and `leaves: true` if it leaves and returns to the board (the 40 s pacer).
4. Check with `node tools/live/stress/run.mjs --list` and `--scenario <name> --dry`.

## Known limits

- CDP input is not a real hand: no pointer jitter, no OS-level scheduling, wheel events arrive at exact intervals.
- Event Timing has a 16 ms floor and reports in 8 ms steps, so small differences in `ttnp` are invisible.
- Traced runs are slower than timed ones and are never used as timings. Timings from the unminified `devbuild.mjs` build are not baselines either.
- The scratch section sits far from real cards, so drags there have fewer neighbours than a real board.
- The bench window must be visible; a hidden window throttles frames and the runner refuses it.
