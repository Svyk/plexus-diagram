// Build state on disk (never /tmp): salt, uploads, highlight uids, page aliases, timings. Written atomically.
import { readFileSync, existsSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { newSalt } from "./uid.mjs";

export const WO = `${homedir()}/wo/pxd-phd`;

export function statePathFor(name) {
  return name === "real" ? `${WO}/build-state.json` : `${WO}/build-state.${name}.json`;
}

export function loadState(path, init = {}) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  return {
    schema: "pxd-phd-build/1",
    salt: newSalt(),
    startedAt: Date.now(),
    uploads: {},
    pdfPage: {},
    hl: {},
    hlMissed: {},
    hlMeta: {},
    images: {},
    alias: {},
    createdDaily: [],
    failed: [],
    timings: {},
    stages: {},
    ...init,
  };
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, path);
}
