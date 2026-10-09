"""Pairing window, model progress, LaunchAgent plist, installer text. No Docling, no launchctl."""

import os
import plistlib
import stat
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from plexus_parse_helper import models
from plexus_parse_helper.agent import PLIST_LABEL, render_plist, resolve_bin
from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.jobs import JobManager
from plexus_parse_helper.pair import PAIR_SECONDS, close_window, open_window, window_open
from plexus_parse_helper.server import create_app
from plexus_parse_helper.__main__ import main

TOKEN = "test-token"
ROAM = "https://roamresearch.com"
HERE = Path(__file__).resolve().parent
INSTALL = HERE.parent / "install.sh"


def _client(tmp_path, **kw):
    app = create_app(
        token=TOKEN,
        jobs=JobManager(runner=lambda *a: {}),
        cache=ParseCache(tmp_path / "cache", max_bytes=1_000_000),
        pair_file=tmp_path / "pair-until",
        **kw,
    )
    return TestClient(app)


def test_window_opens_for_90_seconds_and_file_is_private(tmp_path):
    path = tmp_path / "pair-until"
    assert window_open(path, now=lambda: 100.0) is False
    until = open_window(path, now=lambda: 100.0)
    assert until == 100.0 + PAIR_SECONDS == 190.0
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert window_open(path, now=lambda: 189.0) is True
    assert window_open(path, now=lambda: 190.5) is False


def test_window_ignores_a_file_dated_far_ahead(tmp_path):
    path = tmp_path / "pair-until"
    path.write_text("999999999999\n")
    assert window_open(path, now=lambda: 100.0) is False


def test_pair_is_404_until_the_window_opens(tmp_path):
    client = _client(tmp_path)
    assert client.get("/v1/pair", headers={"Origin": ROAM}).status_code == 404
    assert client.get("/v1/pair").status_code == 404


def test_pair_returns_the_token_once_to_an_allowed_origin(tmp_path):
    client = _client(tmp_path)
    open_window(tmp_path / "pair-until")
    first = client.get("/v1/pair", headers={"Origin": ROAM})
    assert first.status_code == 200
    assert first.json() == {"token": TOKEN, "helper": "plexus-parse-helper", "version": "0.1.0"}
    assert first.headers["access-control-allow-origin"] == ROAM
    assert first.headers["cache-control"] == "no-store"
    assert client.get("/v1/pair", headers={"Origin": ROAM}).status_code == 404
    assert window_open(tmp_path / "pair-until") is False


def test_pair_refuses_no_origin_and_other_origins_and_keeps_the_window(tmp_path):
    client = _client(tmp_path)
    open_window(tmp_path / "pair-until")
    assert client.get("/v1/pair").status_code == 404
    evil = client.get("/v1/pair", headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert "token" not in evil.text
    assert window_open(tmp_path / "pair-until") is True
    assert client.get("/v1/pair", headers={"Origin": ROAM}).status_code == 200


def test_expired_window_is_404(tmp_path):
    client = _client(tmp_path)
    open_window(tmp_path / "pair-until", now=lambda: 1.0)
    assert client.get("/v1/pair", headers={"Origin": ROAM}).status_code == 404


def test_pair_preflight_is_allowed_for_roam(tmp_path):
    client = _client(tmp_path)
    pre = client.options("/v1/pair", headers={"Origin": ROAM})
    assert pre.status_code == 204
    assert pre.headers["access-control-allow-private-network"] == "true"


def test_other_routes_still_need_the_token_during_a_window(tmp_path):
    client = _client(tmp_path)
    open_window(tmp_path / "pair-until")
    assert client.get("/v1/models").status_code == 401
    assert client.get("/v1/health").status_code == 401


def test_pair_command_writes_the_window(tmp_path, capsys):
    token = tmp_path / "token"
    pair = tmp_path / "pair-until"
    assert main(["pair", "--token-file", str(token), "--pair-file", str(pair), "--seconds", "30"]) == 0
    assert token.is_file() and window_open(pair)
    out = capsys.readouterr().out
    assert "Back to Roam: click Pair." in out
    assert close_window(pair) is True
    assert close_window(pair) is False


def _fake_hub(tmp_path, ready=(), partial=None):
    hub = tmp_path / "hub"
    for name in ready:
        (hub / models._HUB_NAMES[name] / "snapshots" / "abc").mkdir(parents=True)
    if partial:
        name, size = partial
        blobs = hub / models._HUB_NAMES[name] / "blobs"
        blobs.mkdir(parents=True)
        (blobs / "x.incomplete").write_bytes(b"0" * size)
    return hub


def test_model_report_counts_partial_download_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "ocrmac_importable", lambda: True)
    monkeypatch.setattr(models, "_downloading", lambda: True)
    hub = _fake_hub(tmp_path, ready=["layout"], partial=("tableformer", 1000))
    report = models.model_report(hub)
    by = {i["name"]: i for i in report["items"]}
    assert report["state"] == "downloading"
    assert by["layout"]["state"] == "ready" and by["layout"]["done"] == by["layout"]["bytes"]
    assert by["tableformer"]["state"] == "downloading"
    assert by["tableformer"]["done"] == 1000
    assert by["tableformer"]["bytes"] == models.MEASURED_BYTES["tableformer"]
    assert report["health"]["tableformer"] == "missing"
    want = models.MEASURED_BYTES["tableformer"] + models.MEASURED_BYTES["formula"]
    assert report["bytes"] == want
    assert report["done"] == 1000
    assert report["fraction"] == round(1000 / want, 4)


def test_model_report_idle_and_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "ocrmac_importable", lambda: True)
    monkeypatch.setattr(models, "_downloading", lambda: False)
    hub = _fake_hub(tmp_path)
    idle = models.model_report(hub)
    assert idle["state"] == "missing" and idle["fraction"] == 0.0
    assert {i["state"] for i in idle["items"] if i["name"] != "ocr"} == {"missing"}
    full = _fake_hub(tmp_path / "b", ready=["layout", "tableformer", "formula"])
    done = models.model_report(full)
    assert done["state"] == "ready" and done["fraction"] == 1.0 and done["bytes"] == 0


def test_models_route_exposes_progress_and_download_can_be_stopped(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "ocrmac_importable", lambda: True)
    client = _client(tmp_path)
    auth = {"Authorization": f"Bearer {TOKEN}"}
    body = client.get("/v1/models", headers=auth).json()
    assert {"state", "items", "bytes", "done", "fraction"} <= set(body)
    assert client.delete("/v1/models/download").status_code == 401
    stopped = client.delete("/v1/models/download", headers=auth)
    assert stopped.status_code == 200 and stopped.json() == {"stopped": False}


def test_stop_download_ends_a_running_process(monkeypatch):
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
    try:
        monkeypatch.setattr(models, "_download_proc", proc)
        assert models.stop_download() == {"stopped": True}
        assert proc.wait(timeout=5) != 0
        assert models.stop_download() == {"stopped": False}
    finally:
        if proc.poll() is None:
            proc.kill()


def test_plist_runs_the_installed_binary_and_is_valid(tmp_path):
    home = tmp_path / "home"
    data = render_plist("/Users/x/.local/bin/plexus-parse-helper", home)
    assert data["Label"] == PLIST_LABEL == "com.plexus.parse-helper"
    assert data["ProgramArguments"] == ["/Users/x/.local/bin/plexus-parse-helper", "serve"]
    assert data["RunAtLoad"] is True
    assert data["StandardOutPath"] == str(home / "Library/Logs/plexus-parse-helper.log")
    assert ".local/bin" in data["EnvironmentVariables"]["PATH"]
    assert plistlib.loads(plistlib.dumps(data)) == data
    assert render_plist("/b", home) == render_plist("/b", home)


def test_resolve_bin_never_points_inside_site_packages():
    assert "site-packages" not in resolve_bin()


def test_install_agent_is_idempotent(tmp_path, monkeypatch):
    import plexus_parse_helper.__main__ as cli

    agent = tmp_path / "LaunchAgents" / "x.plist"
    calls = []
    monkeypatch.setattr(cli, "AGENT_PATH", agent)
    monkeypatch.setattr(cli, "resolve_bin", lambda: "/bin/helper")
    monkeypatch.setattr(cli.Path, "home", classmethod(lambda c: tmp_path))

    def fake_run(cmd, check=False, **kw):
        calls.append(cmd[:2])
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    assert main(["install-agent"]) == 0
    first = agent.read_bytes()
    assert main(["install-agent"]) == 0
    assert agent.read_bytes() == first
    assert plistlib.loads(first)["ProgramArguments"] == ["/bin/helper", "serve"]
    verbs = [c[1] for c in calls]
    assert verbs == ["bootout", "bootstrap", "bootout", "bootstrap"]


def test_install_agent_falls_back_to_kickstart_when_bootstrap_fails(tmp_path, monkeypatch):
    import plexus_parse_helper.__main__ as cli

    calls = []
    monkeypatch.setattr(cli, "AGENT_PATH", tmp_path / "x.plist")
    monkeypatch.setattr(cli, "resolve_bin", lambda: "/bin/helper")
    monkeypatch.setattr(cli.Path, "home", classmethod(lambda c: tmp_path))

    def fake_run(cmd, check=False, **kw):
        calls.append(cmd[1])
        return subprocess.CompletedProcess(cmd, 5 if cmd[1] == "bootstrap" else 0)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    assert main(["install-agent"]) == 0
    assert calls == ["bootout", "bootstrap", "kickstart"]


def test_installer_script_text():
    text = INSTALL.read_text()
    assert text.startswith("#!/bin/sh")
    assert os.access(INSTALL, os.X_OK)
    assert subprocess.run(["sh", "-n", str(INSTALL)]).returncode == 0
    order = [text.index(s) for s in ("astral.sh/uv/install.sh", "uv tool install --force", "install-agent", '"$HELPER" pair')]
    assert order == sorted(order)
    assert 'say "Back to Roam: click Pair."' not in text
    assert "command -v uv" in text
    assert "subdirectory=tools/parse-helper" in text
    assert "Svyk/plexus-diagram" in text
