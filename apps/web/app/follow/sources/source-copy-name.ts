const SOURCE_NAME_MAX_LENGTH = 64;

function normalizeSourceName(name: string): string {
  const trimmed = name.trim();
  return trimmed || "Source";
}

function clampBaseName(baseName: string, suffix: string): string {
  const maxBaseLength = Math.max(1, SOURCE_NAME_MAX_LENGTH - suffix.length);
  return baseName.slice(0, maxBaseLength).trimEnd();
}

function buildCopyName(baseName: string, copyIndex: number): string {
  const suffix = copyIndex <= 1 ? " (Copy)" : ` (Copy ${copyIndex})`;
  const clampedBaseName = clampBaseName(baseName, suffix);
  return `${clampedBaseName}${suffix}`;
}

export function reserveCopySourceName(originalName: string, existingNames: string[]): string {
  const baseName = normalizeSourceName(originalName);
  const usedNames = new Set(
    existingNames
      .map((name) => name.trim())
      .filter(Boolean)
  );

  let copyIndex = 1;
  let candidate = buildCopyName(baseName, copyIndex);
  while (usedNames.has(candidate)) {
    copyIndex += 1;
    candidate = buildCopyName(baseName, copyIndex);
  }

  return candidate;
}
