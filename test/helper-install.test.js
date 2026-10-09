// The macOS installer: light Rust helper by default, Docling via --docling, uninstall.
// A fake release directory and a fake launchctl. Never the helper on 48765.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = new URL("../tools/parse-helper/install.sh", import.meta.url);

function countPair(text) {
  return text.split("Back to Roam: click Pair.").length - 1;
}

function machineArch() {
  switch (process.arch) {
    case "arm64": return "arm64";
    case "x64": return "x86_64";
    default: return process.arch;
  }
}

async function layout() {
  const root = await mkdtemp(path.join(tmpdir(), "pxd-helper-install-"));
  const home = path.join(root, "home");
  const prefix = path.join(root, "prefix");
  const agents = path.join(root, "agents");
  const release = path.join(root, "release");
  const bin = path.join(root, "bin");
  await Promise.all([home, prefix, agents, release, bin].map((dir) => import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }))));
  const log = path.join(root, "launchctl.log");
  const curlLog = path.join(root, "curl.log");
  const launchctl = path.join(bin, "launchctl");
  const curl = path.join(bin, "curl");
  await writeFile(launchctl, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);
  await chmod(launchctl, 0o755);
  // Stands in for curl. A health probe is open only when the test says so,
  // and the install never talks to a live port.
  await writeFile(curl, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}
case "$*" in
  */v1/health*)
    if [ "\${PLEXUS_TEST_PORT_OPEN:-0}" = 1 ]; then exit 0; fi
    exit 7
    ;;
esac
printf 'unexpected curl: %s\\n' "$*" >&2
exit 1
`);
  await chmod(curl, 0o755);
  const uv = path.join(bin, "uv");
  await writeFile(uv, `#!/bin/sh\nprintf '%s\\n' "uv $*" >> ${JSON.stringify(log)}\nexit 0\n`);
  await chmod(uv, 0o755);
  const helper = path.join(bin, "plexus-parse-helper");
  await writeFile(helper, "#!/bin/sh\nif [ \"$1\" = pair ]; then echo 'Back to Roam: click Pair.'; fi\nexit 0\n");
  await chmod(helper, 0o755);
  return { root, home, prefix, agents, release, bin, log, curlLog, launchctl };
}

async function fakeRelease(dir, arch) {
  const stage = path.join(dir, "stage");
  await import("node:fs/promises").then((fs) => fs.mkdir(stage, { recursive: true }));
  const binary = path.join(stage, "plexus-parse-helper-rs");
  await writeFile(binary, "#!/bin/sh\nif [ \"$1\" = pair ]; then\n  echo 'Pairing is open for 90 s.'\n  echo 'Back to Roam: click Pair.'\nfi\nexit 0\n");
  await chmod(binary, 0o755);
  await writeFile(path.join(stage, "libpdfium.dylib"), "not a real dylib\n");
  const asset = `plexus-parse-helper-rs-macos-${arch}.tar.gz`;
  const packed = spawnSync("tar", ["-czf", path.join(dir, asset), "-C", stage, "plexus-parse-helper-rs", "libpdfium.dylib"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const hash = createHash("sha256").update(await readFile(path.join(dir, asset))).digest("hex");
  await writeFile(path.join(dir, "SHA256SUMS"), `${hash}  ${asset}\n`);
  return asset;
}

function run(dir, args, extra = {}) {
  const env = {
    HOME: dir.home,
    PATH: extra.path || `${dir.bin}:/usr/bin:/bin`,
    TMPDIR: tmpdir(),
    USER: "plexus-test",
    LOGNAME: "plexus-test",
    PLEXUS_HELPER_PREFIX: dir.prefix,
    PLEXUS_LAUNCH_AGENTS_DIR: dir.agents,
    PLEXUS_LAUNCHCTL: dir.launchctl,
    PLEXUS_HELPER_LOG: path.join(dir.root, "helper.log"),
    PLEXUS_HELPER_SKIP_WAIT: "1",
    PLEXUS_HELPER_RELEASE_DIR: dir.release,
    PLEXUS_HELPER_ARCH: machineArch(),
    ...extra.env,
  };
  return spawnSync("sh", [script.pathname, ...args], { env, encoding: "utf8" });
}

test("installer script is executable, documents quarantine, and passes sh -n", async () => {
  const text = await readFile(script, "utf8");
  await access(script, 1);
  assert.match(text, /xattr -d com\.apple\.quarantine/);
  assert.match(text, /curl does not set the Gatekeeper quarantine attribute/);
  const check = spawnSync("sh", ["-n", script.pathname], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("a verified release installs the rust helper, a second run is safe, and uninstall removes it", async () => {
  const dir = await layout();
  const arch = machineArch();
  try {
    await fakeRelease(dir.release, arch);
    const env = { PLEXUS_HELPER_PORT: "48767", PLEXUS_HELPER_URL: "http://127.0.0.1:48767" };
    const first = run(dir, [], { env });
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.equal(countPair(first.stdout), 1);
    const installed = path.join(dir.prefix, "bin", "plexus-parse-helper-rs");
    const dylib = path.join(dir.prefix, "bin", "libpdfium.dylib");
    assert.equal(await readFile(installed, "utf8").then((text) => text.includes("pair")), true);
    assert.equal(await readFile(dylib, "utf8"), "not a real dylib\n");
    const plist = await readFile(path.join(dir.agents, "com.plexus.parse-helper.plist"), "utf8");
    assert.match(plist, /com\.plexus\.parse-helper/);
    assert.match(plist, /<string>48767<\/string>/);
    assert.match(plist, /plexus-parse-helper-rs/);
    assert.match(plist, /libpdfium\.dylib/);
    assert.match(plist, /--token-file/);
    assert.match(plist, /RunAtLoad/);
    const again = run(dir, [], { env });
    assert.equal(again.status, 0, again.stderr + again.stdout);
    const beforeUnload = await readFile(dir.log, "utf8");
    assert.match(beforeUnload, /bootout/);
    const removed = run(dir, ["--uninstall"], { env });
    assert.equal(removed.status, 0, removed.stderr + removed.stdout);
    assert.match(removed.stdout, /left running/);
    assert.match(removed.stdout, /Removed/);
    assert.equal(await readFile(dir.log, "utf8"), beforeUnload);
    await assert.rejects(access(path.join(dir.agents, "com.plexus.parse-helper.plist")));
    await assert.rejects(access(installed));

    const loginAgents = path.join(dir.home, "Library", "LaunchAgents");
    await mkdir(loginAgents, { recursive: true });
    await writeFile(dir.log, "");
    const login = run(dir, [], { env: { ...env, PLEXUS_LAUNCH_AGENTS_DIR: loginAgents } });
    assert.equal(login.status, 0, login.stderr + login.stdout);
    await writeFile(dir.log, "");
    const loginRemoved = run(dir, ["--uninstall"], { env: { ...env, PLEXUS_LAUNCH_AGENTS_DIR: loginAgents } });
    assert.equal(loginRemoved.status, 0, loginRemoved.stderr + loginRemoved.stdout);
    assert.match(await readFile(dir.log, "utf8"), /bootout/);
    await assert.rejects(access(path.join(loginAgents, "com.plexus.parse-helper.plist")));
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test("a taken port is refused unless --replace, and a bad checksum installs nothing", async () => {
  const dir = await layout();
  const arch = machineArch();
  try {
    await fakeRelease(dir.release, arch);
    const env = {
      PLEXUS_HELPER_PORT: "48767",
      PLEXUS_HELPER_URL: "http://127.0.0.1:48767",
      PLEXUS_TEST_PORT_OPEN: "1",
    };
    const refused = run(dir, [], { env });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /--replace/);
    assert.match(refused.stderr, /left running/);
    await assert.rejects(access(path.join(dir.prefix, "bin", "plexus-parse-helper-rs")));
    assert.equal(await readFile(dir.log, "utf8").catch(() => ""), "");

    const replaced = run(dir, ["--replace"], { env });
    assert.equal(replaced.status, 0, replaced.stderr + replaced.stdout);
    const replacedLog = await readFile(dir.log, "utf8");
    assert.match(replacedLog, /bootout/);
    const unloaded = run(dir, ["--uninstall"], { env });
    assert.equal(unloaded.status, 0, unloaded.stderr + unloaded.stdout);
    assert.match(unloaded.stdout, /left running/);
    assert.equal(await readFile(dir.log, "utf8"), replacedLog);

    const fresh = await layout();
    try {
      await fakeRelease(fresh.release, arch);
      await writeFile(path.join(fresh.release, "SHA256SUMS"), `0000000000000000000000000000000000000000000000000000000000000000  plexus-parse-helper-rs-macos-${arch}.tar.gz\n`);
      const bad = run(fresh, [], { env: { PLEXUS_HELPER_PORT: "48767", PLEXUS_HELPER_URL: "http://127.0.0.1:48767" } });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /SHA256/);
      await assert.rejects(access(path.join(fresh.prefix, "bin", "plexus-parse-helper-rs")));
    } finally {
      await rm(fresh.root, { recursive: true, force: true });
    }
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test("--docling and a non-macOS install keep the Python path", async () => {
  const dir = await layout();
  try {
    const env = {
      PLEXUS_HELPER_PORT: "9",
      PLEXUS_HELPER_URL: "http://127.0.0.1:9",
      PLEXUS_HELPER_RELEASE_DIR: "",
    };
    const docling = run(dir, ["--docling"], { path: `${dir.bin}:/usr/bin:/bin`, env });
    assert.equal(docling.status, 0, docling.stderr + docling.stdout);
    assert.equal(countPair(docling.stdout), 1);
    const log = await readFile(dir.log, "utf8");
    assert.match(log, /uv tool install --force/);
    await assert.rejects(access(path.join(dir.prefix, "bin", "plexus-parse-helper-rs")));

    const linux = run(dir, [], { path: `${dir.bin}:/usr/bin:/bin`, env: { ...env, PLEXUS_HELPER_OS: "Linux" } });
    assert.equal(linux.status, 0, linux.stderr + linux.stdout);
    assert.match(await readFile(dir.log, "utf8"), /uv tool install --force/g);

    await writeFile(dir.log, "");
    const vlm = run(dir, ["--docling", "--vlm"], { path: `${dir.bin}:/usr/bin:/bin`, env });
    assert.equal(vlm.status, 0, vlm.stderr + vlm.stdout);
    assert.match(vlm.stdout, /1\.8 GB/);
    assert.match(vlm.stdout, /204 MB/);
    assert.match(vlm.stdout, /Apache-2\.0/);
    assert.match(await readFile(dir.log, "utf8"), /uv tool install --force --with mlx-vlm --with onnxruntime/);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});
