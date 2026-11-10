# Stress suite

Dev-only Node 20+ tools that drive Roam Desktop over CDP (`http://127.0.0.1:9223`) to measure how fast the Plexus stress board feels. No npm dependencies. Nothing here is bundled or imported by `src/`.

The board is block `KT_KHnsXe` in the `Readwisenotes` graph (about 1500 items, nested chain `3g8aFy9ZW,_pwUcy2_7`).

## Safety rules

- **Bench window.** Only a `Readwisenotes` window marked `sessionStorage["pxd-bench"] === "1"` may be reloaded, navigated, sent input, or used to write Roam data.
- **Svy's own window** runs the passive recorder (`window.__pxdRec`). `record.mjs` may install observers in it and read it. Nothing else touches it. A window whose title starts with `Svy` is never touched at all.
- **Lock file** `~/wo/bench-<first 8 chars of target id>.lock` (`<session> <ISO time> pid=<pid>`). A live lock held by another process stops the run. A dead or six-hour-old lock is replaced.
- **Camera key** `plexus-diagram:vp:Readwisenotes:KT_KHnsXe` is shared by both windows. The runner saves it, and puts back the newest value Svy's window wrote (or the saved one) on every exit.
- **Scratch section and cleanup.** Edit scenarios write only inside a scratch section far from real cards. `run.mjs --cleanup` removes what they made and must print `"clean": true`.
- **Write pacing.** At most 1200 Roam writes a minute (the app's limit is 1500), and a leave-and-return scenario waits 40 s after the last one.
- `window.confirm` is stubbed to answer "no" during a run and restored on exit.

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

## Commands

```bash
# real-use recorder, passive, in Svy's window
node tools/live/stress/record.mjs start  <idPrefix>
node tools/live/stress/record.mjs status <idPrefix>
node tools/live/stress/record.mjs dump   <idPrefix> ~/wo/pxd-fast/rec/real-2.json [--stop]
node tools/live/stress/record.mjs stop   <idPrefix>

# turn a recording into stalls, owners, gestures and a "reproduce" block
node tools/live/stress/analyse.mjs ~/wo/pxd-fast/rec/real-1.json --json rec/real-1.analysis.json
node tools/live/stress/analyse.mjs --selftest

# the suite, in the bench window
node tools/live/stress/run.mjs --list
node tools/live/stress/run.mjs --quick                      # one run of everything not heavy, about 6 min
node tools/live/stress/run.mjs --group move --n 5 --label base
node tools/live/stress/run.mjs --scenario zoom-btn,fit --n 3 --trace
node tools/live/stress/run.mjs --build deploy --label try   # serve another build (extension.js + extension.css)
node tools/live/stress/run.mjs --cleanup

# compare two builds, interleaved
node tools/live/stress/ab.mjs --aa --a deploy --scenario zoom-btn --label aa1       # noise floor first
node tools/live/stress/ab.mjs --a ../base/deploy --b deploy --scenario zoom-btn --label ab1

# round report
node tools/live/stress/report.mjs --label base --rec rec/real-1.analysis.json --out ~/wo/pxd-fast/round0.md
node tools/live/stress/report.mjs --label base --write-budgets

# split a trace into script / style / layout / paint / gc
node tools/live/stress/lib/trace-analyse.mjs ~/wo/pxd-fast/traces/<file>.json.gz [--json]
```

`run.mjs` flags: `--group a,b`, `--scenario a,b`, `--n 3`, `--label base`, `--build <dir>`, `--trace` (one extra traced pass per scenario), `--selectors` (selector stats in traces), `--quick` (n 1, short variants), `--soak-min 30`, `--target <idPrefix>`, `--out <dir>`, `--list`, `--dry` (print the plan, never connect), `--cleanup`, `--keep-going`, `--inline` (stay out of fullscreen), `--chain a,b`, `--timeout <ms>`. Heavy scenarios (`idle-2min`, `soak`) run only when named.

`ab.mjs` runs `n` rounds (at least 5 unless `--force`). In even rounds the order is A then B, in odd rounds B then A. Each arm is one `run.mjs` call with `--build <dir> --n 1 --label <label>:<arm>`. It waits 40 s between arms (`--wait <s>`). `--aa` serves the same build as arms `A1` and `A2` and appends one line per scenario and metric to `noise.jsonl`. An A/B run reads the newest floor for each scenario and metric from there; a difference is only called better when it is larger than the floor. Lower is better for every metric. Metrics: `ttnp`, `stalls.total`, `stalls.worst`, `stalls.n`, `frames.max`, `content.live.p95`, `long.total`, plus numeric leaves under a scenario's `extra.metrics`.

`budgets.json` holds the plan's goals under `targets` and per-scenario limits under `scenarios`. `report.mjs --write-budgets` sets `ttnp`, `stalls.total` and `stalls.worst` limits to the baseline median rounded up to the next 10. It never raises a limit.

## Scenarios

Names and titles are copied from `run.mjs --list`. Run it for the current list.

| Group | Scenario | What it does |
|---|---|---|
| move | `zoom-btn` | Rail zoom out x13 then zoom in x13, one click at a time |
| move | `drag-pan-reading` | Drag the background 370 px at 107% zoom |
| move | `drag-pan-small` | Same at 63% |
| move | `drag-pan-overview` | Same at 30% |
| move | `drag-pan-map` | Same at 12% |
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
| idle | `idle-2min` | Two minutes with no input: stalls and frames at rest (heavy) |
| idle | `follow-refresh` | Follow source refresh while idle |
| idle | `soak` | 30 minute soak: pans, zoom clicks, idle; heap, nodes, listeners, stalls (heavy) |
| edit | (scenarios/edit.mjs) | Card edit and typing scenarios; the file is skipped with a warning while it does not exist |

## Result line

One JSON object per line in `results.jsonl`:

`run` (id of the run), `at`, `label`, `build {dir, sha}` (`installed` and `null` when no `--build`), `version`, `group`, `scenario`, `i` and `n` (repeat number and count), `traced`, `window {id, inner, dpr, vis, hz}`, `load` (machine load average), `ctx {board, zoom0, zoom1, lod0, lod1, items}`, `stalls {n, total, worst, list}`, `long {n, total, worst}`, `ttnp`, `frames {n, p50, p95, p99, max, over34, over50, over100}`, `input {n, events}`, `content {...}`, `owner {plexus, roam, other, forced, render, unattributed}`, `plexus {longTasks, slowMounts, paintAudit, bgOverruns}`, `trace` (traced lines only), `extra` (scenario-specific), `skip` (reason), `err` (message).

## How the numbers are measured

- **Stall** is a long animation frame (LoAF) of 50 ms or more. `stalls.total` is the sum of their durations, `stalls.worst` the longest. Each stall lists its scripts (url, function, invoker, position in the bundle) and its render and style-and-layout time.
- **Time to next paint (`ttnp`)** is the Event Timing duration of the input (press to the frame that paints after it). When the scenario cannot get an Event Timing row it uses the frame-after-action proxy. Rows under 16 ms do not exist, so a missing row counts as 12 ms.
- **Card states.** Each card in view is `missing` (no shell), `empty` (shell without content), `preview` (static preview rows) or `live` (real content). **Readable** delay is the time from entering view until the card is preview or live; **live** delay until it is live. `content.readable` and `content.live` give n, p50, p95 and max of those delays.
- **Owner split.** From LoAF script attribution each stall's script time goes to Plexus, Roam, or another extension (named by reading the head of the blob script). `render` is style and layout inside stalls, `unattributed` is what no script or render time explains. A traced run gives a second split from the Chrome trace: script by owner, style, layout, paint, gc, other, elements restyled, forced style and layout.
- Timed runs are never traced. `--trace` adds a separate pass per scenario; traced lines carry `traced: true` and are not used for timings.

## Adding a scenario

1. Add an entry to the `scenarios` array of a module in `scenarios/` (`{ name, title, run, heavy?, leaves?, needs? }`) or create a module that exports `group` and `scenarios` and add its name to `SCENARIO_FILES` in `run.mjs`.
2. `run(ctx)` returns `{ summary, extra, ttnp, skip }`. Use `ctx.probe.arm()` and `take()` around the action, `ctx.input` for input, `ctx.show(ctx.at(zoom))` to place the camera. Put per-step numbers in `extra`; the report prints `clickByBand`, `downByBand`, `press`, `release`, `hover`, `presses`, `fast`, `tail`, `keys` and `typing` as tables. Numbers that an A/B run should compare go under `extra.metrics`.
3. Mark it `heavy: true` if it takes more than a few minutes, and `leaves: true` if it leaves and returns to the board (the 40 s pacer).
4. Check with `node tools/live/stress/run.mjs --list` and `--scenario <name> --dry`.

## Known limits

- CDP input is not a real hand: no pointer jitter, no OS-level scheduling, wheel events arrive at exact intervals.
- Event Timing has a 16 ms floor and reports in 8 ms steps, so small differences in `ttnp` are invisible.
- Traced runs are slower than timed ones and are never used as timings.
- The scratch section for edit scenarios sits far from real cards, so drags there have fewer neighbours than a real board.
- The bench window must be visible; a hidden window throttles frames and the runner refuses it.
