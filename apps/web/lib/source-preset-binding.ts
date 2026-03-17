import { BbPresetStatus, Prisma } from "@/app/generated/prisma";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const obj = asObject(value);
  return Object.fromEntries(
    Object.entries(obj).map(([key, item]) => [key, item == null ? "" : String(item)])
  );
}

function resolveDriverName(config: Record<string, unknown>): string {
  const rawDriver = config.driver;
  if (typeof rawDriver === "string") {
    return rawDriver.trim().toLowerCase();
  }
  const wrapped = asObject(rawDriver);
  if (typeof wrapped.name === "string") {
    return wrapped.name.trim().toLowerCase();
  }
  return "";
}

function resolveScriptRelPath(scriptPath: string): string | null {
  const trimmed = scriptPath.trim();
  if (!trimmed) return null;
  const marker = "/bb-sites/";
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length);
  }
  return trimmed.replace(/^\/+/, "");
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

type SyncBindingInput = {
  sourceId: string;
  config: unknown;
};

export async function syncSocialPresetBinding(
  tx: Prisma.TransactionClient,
  input: SyncBindingInput
) {
  const config = asObject(input.config);
  const driverName = resolveDriverName(config);
  if (driverName !== "playwright") {
    await tx.sourcePresetBinding.updateMany({
      where: { sourceId: input.sourceId, enabled: true },
      data: { enabled: false },
    });
    return;
  }

  const playwright = asObject(config.playwright);
  const scriptPath =
    typeof playwright.scriptPath === "string" ? playwright.scriptPath : "";
  const scriptRelPath = resolveScriptRelPath(scriptPath);
  if (!scriptRelPath) {
    await tx.sourcePresetBinding.updateMany({
      where: { sourceId: input.sourceId, enabled: true },
      data: { enabled: false },
    });
    return;
  }

  const preset = await tx.bbPreset.findFirst({
    where: {
      scriptRelPath,
      isActive: true,
      status: { not: BbPresetStatus.BROKEN },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!preset) {
    await tx.sourcePresetBinding.updateMany({
      where: { sourceId: input.sourceId, enabled: true },
      data: { enabled: false },
    });
    return;
  }

  const bindingArgsPayload: Record<string, unknown> = {
    scriptPath,
    args: normalizeStringRecord(playwright.args),
  };

  const output = asObject(config.output);
  if (hasKeys(output)) {
    bindingArgsPayload.output = output;
  }

  await tx.sourcePresetBinding.updateMany({
    where: {
      sourceId: input.sourceId,
      enabled: true,
      NOT: { presetId: preset.id },
    },
    data: { enabled: false },
  });

  await tx.sourcePresetBinding.upsert({
    where: {
      sourceId_presetId: {
        sourceId: input.sourceId,
        presetId: preset.id,
      },
    },
    create: {
      sourceId: input.sourceId,
      presetId: preset.id,
      enabled: true,
      args: bindingArgsPayload as Prisma.InputJsonValue,
    },
    update: {
      enabled: true,
      args: bindingArgsPayload as Prisma.InputJsonValue,
    },
  });
}

