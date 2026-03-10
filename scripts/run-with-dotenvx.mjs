import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const target = args[0];
const npmArgs = args.slice(1);

if (!target || npmArgs.length === 0) {
  console.error(
    "Usage: node scripts/run-with-dotenvx.mjs <target> <npm args...>"
  );
  process.exit(1);
}

const envDir = process.env.OAK_ENV_DIR;
if (!envDir) {
  console.error(
    "Missing OAK_ENV_DIR. Set it to your shared env folder, for example: D:\\Coding\\my-oak-research-env"
  );
  process.exit(1);
}

const commonEnvPath = resolve(envDir, ".env.common");
const appEnvPath = resolve(envDir, `.env.apps.${target}`);

if (!existsSync(appEnvPath)) {
  console.error(`Missing env file: ${appEnvPath}`);
  process.exit(1);
}

const dotenvxArgs = ["run"];
if (existsSync(commonEnvPath)) {
  dotenvxArgs.push("-f", commonEnvPath);
}
dotenvxArgs.push("-f", appEnvPath, "--", "npm", ...npmArgs);

const useShell = process.platform === "win32";
const dotenvxProbe = spawnSync("dotenvx", ["--version"], {
  stdio: "ignore",
  shell: useShell,
});

const runner =
  dotenvxProbe.status === 0
    ? { command: "dotenvx", args: dotenvxArgs }
    : { command: "npx", args: ["-y", "@dotenvx/dotenvx", ...dotenvxArgs] };

const child = spawn(runner.command, runner.args, {
  stdio: "inherit",
  shell: useShell,
});

child.on("error", (error) => {
  const message =
    error instanceof Error ? error.message : "unknown process error";
  console.error(`Failed to run env loader: ${message}`);
  console.error(
    "Install dotenvx first: https://dotenvx.com/docs/install or npm i -g @dotenvx/dotenvx"
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
