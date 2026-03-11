#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const envDirArgIndex = args.indexOf("--env-dir");

let envDirFromArg;
if (envDirArgIndex !== -1) {
  envDirFromArg = args[envDirArgIndex + 1];
  if (!envDirFromArg || envDirFromArg.startsWith("--")) {
    console.error("Missing value for --env-dir");
    process.exit(1);
  }
}

const fallbackEnvDir = path.join(os.homedir(), "Coding", "my-oak-research-env");
const envDir = envDirFromArg || process.env.OAK_ENV_DIR || fallbackEnvDir;

if (!process.env.OAK_ENV_DIR && !envDirFromArg) {
  console.log(`OAK_ENV_DIR is not set, fallback to: ${envDir}`);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(repoRoot, "config", "env");

if (!fs.existsSync(sourceDir)) {
  console.error(`Missing source directory: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(envDir, { recursive: true });

const fileMap = [
  { src: ".env.common.example", dst: ".env.common" },
  { src: ".env.apps.web.example", dst: ".env.apps.web" },
  { src: ".env.apps.worker.example", dst: ".env.apps.worker" },
  { src: ".env.apps.gather.example", dst: ".env.apps.gather" },
];

for (const { src, dst } of fileMap) {
  const srcPath = path.join(sourceDir, src);
  const dstPath = path.join(envDir, dst);

  if (!fs.existsSync(srcPath)) {
    continue;
  }

  if (fs.existsSync(dstPath) && !force) {
    console.log(`skip: ${dstPath}`);
    continue;
  }

  fs.copyFileSync(srcPath, dstPath);
  console.log(`write: ${dstPath}`);
}

console.log(`Done. Shared env dir: ${envDir}`);
