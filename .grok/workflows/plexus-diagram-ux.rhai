let meta = #{
    name: "plexus-diagram-ux",
    description: "Watch a Plexus Diagram usability recording, then rebuild the overlay to be Heptabase-usable",
    when_to_use: "Plexus Diagram overlay is unusable; CleanShot or live Roam UX pass",
    phases: [
        #{ title: "Watch", detail: "gvv the recording unless findings are already passed" },
        #{ title: "Rebuild", detail: "executor-cursor UX pass on canvas, toolbar, cards, library" },
        #{ title: "Verify", detail: "npm run check and author" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "sha", "problems"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "sha": #{ "type": "string" },
        "problems": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let repo = if args == () { () } else { args.repo };
let video = if args == () { () } else { args.video };
let given = if args == () { () } else { args.findings };
if repo == () {
    pause("verification", "Pass args.repo (absolute path to plexus-Diagram). Optional args.video and args.findings.");
}

fn trimmed(s) {
    if type_of(s) == "string" { s.trim(); s } else { "" }
}

let findings_text = trimmed(given);

phase("Watch");
if findings_text == "" && video != () {
    let wp = "";
    wp += "Watch this recording with gvv (local CLI). Do not skip gvv info.\n";
    wp += "Video: " + video + "\n";
    wp += "Run: gvv info <path>\n";
    wp += "If duration is over 30s also run gvv analyze --filters scene,silence\n";
    wp += "Then gvv watch --skip-audio --res 768 --question \"What is unusable about the Plexus Diagram overlay?\"\n";
    wp += "Read timeline.md and contact_sheet.jpg from the cache path in the JSON.\n";
    wp += "Return findings: concrete UX defects (canvas size, toolbar, cards, library, pan/zoom, leftover native chrome).\n";
    let watched = agent(wp, #{
        label: "watch-video",
        agent_type: "executor-cursor",
        capability_mode: "all",
        output_schema: findings_schema,
    });
    if watched != () && watched.success && watched.output != () && watched.output.findings != () {
        findings_text = json_encode(watched.output.findings);
    }
}
if findings_text == "" {
    findings_text = "Default from 2026-08-27 CleanShot 20.47.21: 420px toy board; letter-only toolbar S/C/C/S/N/L; duplicate card title plus renderBlock plus ref-count 1 and bullets; library dump of empty bars; pan requires space; no zoom buttons; overlay does not fill native diagram size.";
}
log("Findings ready");

phase("Rebuild");
let rp = "";
rp += "You are executor-cursor. READ ~/.claude/orch/lane-fit.md and ~/.claude/orch/cursor-roster.md. Launch cursor-run.sh --mechanical --workspace ";
rp += repo;
rp += " --log /tmp/orch/plexus-diagram-ux.log --background, wait, verify npm run check, author Svyatoslav Kleshchev <svyk@icloud.com>, push origin main. Never Auto/Fast. Never Kimi/omp. Never implement yourself.\n";
rp += "Kimi is archived; Composer is the mechanical lane.\n";
rp += "WORK ORDER for cursor-run.sh:\n";
rp += "Repo: " + repo + "\n";
rp += "Bump to v0.2.0. Native-first still: children + metadata + viewport props. Zero runtime deps.\n";
rp += "Video findings: " + findings_text + "\n";
rp += "REQUIRED UX (Heptabase-like, roam-grid discipline):\n";
rp += "1. Board size: before hiding .rm-diagram, measure getBoundingClientRect. Wrapper width 100%, height max(nativeHeight, 560). Default-height setting 560. .pxd-root height 100%.\n";
rp += "2. Toolbar: HORIZONTAL top-left, full labels Select Card Connect Section Nested Library, plus Zoom+ Zoom- Fit. Not first-letter 28px squares. Buttons auto width, padding.\n";
rp += "3. Cards: default show-card-title FALSE. Native renderBlock stays. CSS under .pxd-card hide .rm-block__controls, .rm-bullet, .rm-block__ref-count, .rm-block-children unless render-children-depth is not 0. No duplicate title+body of the same string.\n";
rp += "4. Pan: drag empty canvas pans (not only space). Space still pans. Middle-click pans. Card drag still moves cards in select tool.\n";
rp += "5. Wheel zoom around cursor (adjust viewport x/y so the point under the pointer stays put).\n";
rp += "6. Library: drawer with search input, close button, visible text color var(--cl-font, inherit), skip blank titles, max 30 rows, does not cover the whole board. Clicking Library toggles the drawer.\n";
rp += "7. Fit: toolbar Fit sets viewport so all cards are in view with padding.\n";
rp += "8. Tests: toolbar labels include Select not just S; default-height 560; show-card-title default false. npm run check must pass.\n";
rp += "Commit source+generated together. Push main. Do not open a PR.\n";

let rebuilt = agent(rp, #{
    label: "rebuild-ux",
    agent_type: "executor-cursor",
    capability_mode: "all",
});
if rebuilt == () || !rebuilt.success {
    complete(#{ ok: false, phase: "Rebuild", summary: "UX rebuild failed" });
}

phase("Verify");
let vp = "";
vp += "In " + repo + " run npm run check. git log -1 --format='%H %an <%ae> %s'. Confirm package.json version 0.2.0 and toolbar labels in src/canvas.js are full words. Return ok, sha, problems.\n";
let verified = agent(vp, #{
    label: "verify-check",
    agent_type: "executor-cursor",
    capability_mode: "all",
    output_schema: verify_schema,
});
if verified == () || !verified.success || verified.output == () {
    complete(#{ ok: false, phase: "Verify", summary: "verify agent failed" });
}
complete(#{
    ok: verified.output.ok,
    sha: verified.output.sha,
    problems: verified.output.problems,
    summary: "Plexus Diagram UX pass",
});
