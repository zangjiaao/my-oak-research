#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const gatherDir = path.join(repoRoot, "apps", "gather");
const strict = process.env.GATHER_BOOTSTRAP_STRICT === "true";
const skip = process.env.SKIP_GATHER_BOOTSTRAP === "true";
const venvPython = process.platform === "win32"
  ? path.join(gatherDir, ".venv", "Scripts", "python.exe")
  : path.join(gatherDir, ".venv", "bin", "python");

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function warn(message) {
  console.warn(`\n[gather-bootstrap] ${message}\n`);
}

function runCheck(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: "pipe",
    env: process.env,
    encoding: "utf-8",
  });
}

function verifyPlaywrightRuntime() {
  const check = runCheck(
    "uv",
    [
      "run",
      "python",
      "-c",
      [
        "import importlib.util as u",
        "import pathlib, playwright",
        "root = pathlib.Path(playwright.__file__).resolve().parent",
        "ok_main = u.find_spec('playwright.__main__') is not None",
        "ok_node = (root / 'driver' / 'node').exists()",
        "ok = ok_main and ok_node",
        "print('ok' if ok else 'broken')",
        "raise SystemExit(0 if ok else 1)",
      ].join(";"),
    ],
    gatherDir
  );
  return check.status === 0;
}

if (skip) {
  warn("skip bootstrap because SKIP_GATHER_BOOTSTRAP=true");
  process.exit(0);
}

const uvCheck = run("uv", ["--version"], gatherDir);
if (uvCheck.status !== 0) {
  const message =
    "uv not found, skip gather bootstrap. Install uv then run: cd apps/gather && uv sync && uv run python -m playwright install chromium";
  if (strict) {
    console.error(`[gather-bootstrap] ${message}`);
    process.exit(1);
  }
  warn(message);
  process.exit(0);
}

console.log("[gather-bootstrap] syncing apps/gather python dependencies...");
const syncResult = run("uv", ["sync"], gatherDir);
if (syncResult.status !== 0) {
  const message =
    "uv sync failed. You can retry manually: cd apps/gather && uv sync && uv run python -m playwright install chromium";
  if (strict) {
    console.error(`[gather-bootstrap] ${message}`);
    process.exit(syncResult.status || 1);
  }
  warn(message);
  process.exit(0);
}

if (!verifyPlaywrightRuntime()) {
  console.log(
    "[gather-bootstrap] detected broken playwright package, reinstalling from official PyPI..."
  );
  const reinstallResult = run(
    "uv",
    [
      "pip",
      "install",
      "--python",
      venvPython,
      "--index-url",
      "https://pypi.org/simple",
      "--force-reinstall",
      "playwright",
    ],
    gatherDir
  );
  if (reinstallResult.status !== 0 || !verifyPlaywrightRuntime()) {
    const message =
      "playwright package is still invalid after reinstall. Retry manually: cd apps/gather && uv pip install --python .venv/bin/python --index-url https://pypi.org/simple --force-reinstall playwright && uv run python -m playwright install chromium";
    if (strict) {
      console.error(`[gather-bootstrap] ${message}`);
      process.exit(reinstallResult.status || 1);
    }
    warn(message);
    process.exit(0);
  }
}

console.log("[gather-bootstrap] installing playwright chromium for gather...");
const playwrightResult = run(
  "uv",
  ["run", "python", "-m", "playwright", "install", "chromium"],
  gatherDir
);
if (playwrightResult.status !== 0) {
  const message =
    "playwright install chromium failed. Retry manually: cd apps/gather && uv run python -m playwright install chromium";
  if (strict) {
    console.error(`[gather-bootstrap] ${message}`);
    process.exit(playwrightResult.status || 1);
  }
  warn(message);
  process.exit(0);
}

console.log("[gather-bootstrap] gather bootstrap done.");
