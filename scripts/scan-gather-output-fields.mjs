import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd(), "apps/gather/scripts");

const fieldCount = new Map();
const perFile = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !fullPath.endsWith(".ts")) {
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const match = content.match(/output\.field:\s*(\{[^\n]+})/);
    if (!match) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const keys = Object.keys(parsed);
    if (!keys.length) {
      continue;
    }
    for (const key of keys) {
      fieldCount.set(key, (fieldCount.get(key) ?? 0) + 1);
    }
    perFile.push({
      file: path.relative(process.cwd(), fullPath),
      keys,
    });
  }
}

walk(rootDir);

const fieldStats = [...fieldCount.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([field, count]) => ({ field, count }));

const output = {
  scannedAt: new Date().toISOString(),
  files: perFile.length,
  uniqueFields: fieldStats.length,
  topFields: fieldStats.slice(0, 20),
  fieldStats,
  perFile,
};

console.log(JSON.stringify(output, null, 2));
