import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ensureBucketExists, uploadFile } from "@/lib/storage";
import { BbPresetStatus, Prisma } from "@/app/generated/prisma";

type SyncOptions = {
  rootPath?: string;
};

type MetaBlock = {
  name?: string;
  description?: string;
  args?: Record<string, unknown>;
  output?: Record<string, unknown>;
  platform?: string;
};

type SchemaDiff = {
  key: string;
  fromVersion: string;
  toVersion: string;
  argsChanged: boolean;
  outputChanged: boolean;
};

type SyncSummary = {
  rootPath: string;
  scannedCount: number;
  createdCount: number;
  changedCount: number;
  brokenCount: number;
  skippedCount: number;
  diff: SchemaDiff[];
};

const META_BLOCK_RE = /\/\*\s*@meta\s*([\s\S]*?)\*\//m;

function normalizeRelPath(rootPath: string, fullPath: string): string {
  return path.relative(rootPath, fullPath).replace(/\\/g, "/");
}

function normalizePresetKey(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.js$/i, "");
}

function inferPlatform(relPath: string, metaPlatform?: string): string {
  const raw = metaPlatform?.trim() || relPath.split("/")[0] || "unknown";
  const lowered = raw.toLowerCase();
  if (lowered === "twitter" || lowered === "x") return "X";
  return raw.toUpperCase();
}

function parseMetaBlock(content: string): MetaBlock | null {
  const match = content.match(META_BLOCK_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as MetaBlock;
  } catch {
    return null;
  }
}

async function listScriptFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(".js")) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootPath);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function jsonChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

async function uploadSnapshot(
  key: string,
  version: string,
  content: string,
  scriptRelPath: string
): Promise<string | null> {
  const snapshotEnabled = process.env.BB_PRESET_SNAPSHOT_ENABLED !== "false";
  if (!snapshotEnabled) return null;

  const snapshotKey = `bb-presets/${key}/${version}.js`;
  try {
    await uploadFile(snapshotKey, Buffer.from(content, "utf-8"), "application/javascript", {
      key,
      version,
      scriptRelPath,
    });
    return snapshotKey;
  } catch (error) {
    logger.warn("bb preset snapshot upload failed", {
      key,
      version,
      scriptRelPath,
      error: logger.normalizeError(error),
    });
    return null;
  }
}

export function resolveBbSiteRoot(rootPath?: string): string {
  const resolved = rootPath || process.env.BB_SITE_ROOT;
  if (!resolved || !resolved.trim()) {
    throw new Error("BB_SITE_ROOT is not configured");
  }
  return path.resolve(resolved.trim());
}

export async function syncBbPresets(options: SyncOptions = {}): Promise<SyncSummary> {
  const rootPath = resolveBbSiteRoot(options.rootPath);

  const syncLog = await prisma.bbPresetSyncLog.create({
    data: {
      rootPath,
      status: "SUCCEEDED",
      startedAt: new Date(),
    },
    select: { id: true },
  });

  try {
    await fs.access(rootPath);

    if (process.env.BB_PRESET_SNAPSHOT_ENABLED !== "false") {
      await ensureBucketExists();
    }

    const files = await listScriptFiles(rootPath);
    const activePresets = await prisma.bbPreset.findMany({
      where: { isActive: true },
      select: {
        id: true,
        key: true,
        version: true,
        scriptRelPath: true,
        status: true,
      },
    });

    const seenRelPaths = new Set<string>();
    const diff: SchemaDiff[] = [];
    let createdCount = 0;
    let changedCount = 0;
    let skippedCount = 0;

    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const relPath = normalizeRelPath(rootPath, filePath);
      seenRelPaths.add(relPath);

      const meta = parseMetaBlock(content);
      if (!meta) {
        skippedCount += 1;
        continue;
      }

      const hash = createHash("sha256").update(content).digest("hex");
      const version = hash.slice(0, 12);
      const key = normalizePresetKey(meta.name || relPath);
      const scriptSnapshotKey = await uploadSnapshot(key, version, content, relPath);

      const argsSchema = (meta.args ?? {}) as Prisma.JsonObject;
      const outputSchema = (meta.output ?? {}) as Prisma.JsonObject;

      const existing = await prisma.bbPreset.findUnique({
        where: { key_version: { key, version } },
      });

      if (!existing) {
        await prisma.bbPreset.create({
          data: {
            key,
            version,
            name: meta.name?.trim() || key,
            description: meta.description?.trim() || null,
            platform: inferPlatform(relPath, meta.platform),
            scriptRelPath: relPath,
            scriptHash: hash,
            scriptSnapshotKey,
            argsSchema,
            outputSchema,
            status: BbPresetStatus.ACTIVE,
            isActive: true,
          },
        });
        createdCount += 1;

        const previous = await prisma.bbPreset.findFirst({
          where: {
            key,
            NOT: { version },
          },
          orderBy: { createdAt: "desc" },
          select: {
            version: true,
            argsSchema: true,
            outputSchema: true,
          },
        });

        if (previous) {
          const argsChanged = jsonChanged(previous.argsSchema, argsSchema);
          const outputChanged = jsonChanged(previous.outputSchema, outputSchema);
          if (argsChanged || outputChanged) {
            diff.push({
              key,
              fromVersion: previous.version,
              toVersion: version,
              argsChanged,
              outputChanged,
            });
            changedCount += 1;
          }
        }
      } else if (existing.status === BbPresetStatus.BROKEN || !existing.isActive) {
        await prisma.bbPreset.update({
          where: { id: existing.id },
          data: {
            status: BbPresetStatus.ACTIVE,
            isActive: true,
            scriptHash: hash,
            scriptSnapshotKey: scriptSnapshotKey ?? existing.scriptSnapshotKey,
            scriptRelPath: relPath,
          },
        });
      }
    }

    const missing = activePresets.filter(
      (preset) => !seenRelPaths.has(preset.scriptRelPath) && preset.status !== BbPresetStatus.BROKEN
    );

    await Promise.all(
      missing.map((preset) =>
        prisma.bbPreset.update({
          where: { id: preset.id },
          data: {
            status: BbPresetStatus.BROKEN,
            isActive: false,
          },
        })
      )
    );

    const summary: SyncSummary = {
      rootPath,
      scannedCount: files.length,
      createdCount,
      changedCount,
      brokenCount: missing.length,
      skippedCount,
      diff,
    };

    await prisma.bbPresetSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        scannedCount: summary.scannedCount,
        createdCount: summary.createdCount,
        changedCount: summary.changedCount,
        brokenCount: summary.brokenCount,
        skippedCount: summary.skippedCount,
        diff: summary.diff as Prisma.InputJsonValue,
      },
    });

    return summary;
  } catch (error) {
    await prisma.bbPresetSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
