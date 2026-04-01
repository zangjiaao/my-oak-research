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

if (skip) {
  warn("skip bootstrap because SKIP_GATHER_BOOTSTRAP=true");
  process.exit(0);
}

const uvCheck = run("uv", ["--version"], gatherDir);
if (uvCheck.status !== 0) {
  const message =
    "uv not found, skip gather bootstrap. Install uv then run: cd apps/gather && uv sync && uv run playwright install chromium";
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
    "uv sync failed. You can retry manually: cd apps/gather && uv sync && uv run playwright install chromium";
  if (strict) {
    console.error(`[gather-bootstrap] ${message}`);
    process.exit(syncResult.status || 1);
  }
  warn(message);
  process.exit(0);
}

console.log("[gather-bootstrap] installing playwright chromium for gather...");
const playwrightResult = run("uv", ["run", "playwright", "install", "chromium"], gatherDir);
if (playwrightResult.status !== 0) {
  const message =
    "playwright install chromium failed. Retry manually: cd apps/gather && uv run playwright install chromium";
  if (strict) {
    console.error(`[gather-bootstrap] ${message}`);
    process.exit(playwrightResult.status || 1);
  }
  warn(message);
  process.exit(0);
}

console.log("[gather-bootstrap] gather bootstrap done.");
