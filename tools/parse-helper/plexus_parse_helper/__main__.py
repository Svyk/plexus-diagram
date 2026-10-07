"""plexus-parse-helper serve|token|install-agent|uninstall-agent|parse."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

from plexus_parse_helper import DEFAULT_PORT, HELPER_NAME
from plexus_parse_helper.auth import load_or_create_token, print_token_banner
from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.jobs import JobManager, ProcessWorker, convert_file
from plexus_parse_helper.schema import normalize_options
from plexus_parse_helper.server import create_app

ROOT = Path(__file__).resolve().parents[1]
PLIST_TEMPLATE = ROOT / "launchd" / "com.plexus.parse-helper.plist.template"
PLIST_LABEL = "com.plexus.parse-helper"
AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / f"{PLIST_LABEL}.plist"
BIN = ROOT / "bin" / "plexus-parse-helper"


def _pages(text: str | None):
    if not text:
        return None
    pages = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            pages.append([int(a), int(b)])
        else:
            pages.append(int(part))
    return pages


def cmd_serve(args) -> int:
    if args.host not in {"127.0.0.1", "localhost"}:
        print("refusing to bind anything but 127.0.0.1", file=sys.stderr)
        return 2
    token, created = load_or_create_token(Path(args.token_file) if args.token_file else None)
    if created:
        print_token_banner(token)
    allow = ["https://roamresearch.com", *args.allow_origin]
    worker = ProcessWorker()
    manager = JobManager(worker=worker)
    app = create_app(
        token=token,
        allow_origins=allow,
        jobs=manager,
        cache=ParseCache(max_bytes=int(float(args.cache_max_gb) * 1024 ** 3)),
    )
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
    worker.close()
    return 0


def cmd_token(args) -> int:
    token, created = load_or_create_token(Path(args.token_file) if args.token_file else None)
    if created:
        print_token_banner(token)
    else:
        print(token)
    return 0


def cmd_parse(args) -> int:
    options = normalize_options({
        "ocr": args.ocr,
        "formula": bool(args.formula),
        "tables": "accurate",
        "pictures": True,
        "pages": _pages(args.pages),
    })
    doc = convert_file(args.pdf, options)
    tables = [b for b in doc["blocks"].values() if b.get("type") == "table"]
    summary = {
        "seconds": round(doc["stats"]["ms"] / 1000, 2),
        "pages": doc["pageCount"],
        "tables": len(tables),
        "blocks": len(doc["blocks"]),
    }
    if args.truth:
        sys.path.insert(0, str(ROOT / "tests"))
        import score
        summary["score"] = score.score_document(doc, json.loads(Path(args.truth).read_text(encoding="utf-8")))
    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def _render_plist() -> dict:
    text = PLIST_TEMPLATE.read_text(encoding="utf-8")
    text = text.replace("__BIN__", str(BIN))
    text = text.replace("__HOME__", str(Path.home()))
    return plistlib.loads(text.encode("utf-8"))


def cmd_install_agent(_args) -> int:
    AGENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AGENT_PATH.open("wb") as fh:
        plistlib.dump(_render_plist(), fh)
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(AGENT_PATH)], check=False)
    subprocess.run(["launchctl", "bootstrap", domain, str(AGENT_PATH)], check=True)
    print(AGENT_PATH)
    return 0


def cmd_uninstall_agent(_args) -> int:
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(AGENT_PATH)], check=False)
    AGENT_PATH.unlink(missing_ok=True)
    print("removed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog=HELPER_NAME)
    sub = parser.add_subparsers(dest="cmd", required=True)

    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    serve.add_argument("--allow-origin", action="append", default=[])
    serve.add_argument("--token-file", default=None)
    serve.add_argument("--workers", type=int, default=1)
    serve.add_argument("--cache-max-gb", default="5")
    serve.set_defaults(func=cmd_serve)

    token = sub.add_parser("token")
    token.add_argument("--token-file", default=None)
    token.set_defaults(func=cmd_token)

    parse = sub.add_parser("parse")
    parse.add_argument("pdf")
    parse.add_argument("--pages", default=None, help="1,3,5-9")
    parse.add_argument("--json", default=None)
    parse.add_argument("--formula", action="store_true")
    parse.add_argument("--ocr", default="auto", choices=["auto", "on", "off"])
    parse.add_argument("--truth", default=None)
    parse.set_defaults(func=cmd_parse)

    sub.add_parser("install-agent").set_defaults(func=cmd_install_agent)
    sub.add_parser("uninstall-agent").set_defaults(func=cmd_uninstall_agent)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
