type UnknownObject = Record<string, unknown>;

function asObject(value: unknown): UnknownObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownObject;
  }
  return {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
}

function hasLockedRecallBinding(recallBinding: unknown): boolean {
  const binding = asObject(recallBinding);
  if (Object.keys(binding).length === 0) return false;

  const enabled =
    typeof binding.enabled === "boolean" ? binding.enabled : true;
  const argKeys = toStringArray(binding.argKeys);
  const effectiveArgKeys = argKeys.length > 0 ? argKeys : ["query"];
  return enabled && effectiveArgKeys.length > 0;
}

export function sourceHasLockedRecallArgs(source: unknown): boolean {
  const sourceObject = asObject(source);
  const socialConfig = asObject(asObject(sourceObject.social).config);
  const socialIntent = asObject(socialConfig.intent);

  const webParseRules = asObject(asObject(sourceObject.web).parseRules);
  const webGather = asObject(webParseRules.gather);
  const webIntent = asObject(webGather.intent);

  const searchOptions = asObject(asObject(sourceObject.search).options);
  const searchIntent = asObject(searchOptions.intent);

  return [
    socialIntent.recallBinding,
    webIntent.recallBinding,
    searchIntent.recallBinding,
  ].some((candidate) => hasLockedRecallBinding(candidate));
}
