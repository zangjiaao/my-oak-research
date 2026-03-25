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

  const enabled = binding.enabled === true;
  const argKeys = toStringArray(binding.argKeys);
  return enabled && argKeys.length > 0;
}

export function sourceHasLockedRecallArgs(source: unknown): boolean {
  const sourceObject = asObject(source);
  const socialConfig = asObject(asObject(sourceObject.social).config);
  const socialIntent = asObject(socialConfig.intent);
  const socialRuntime = asObject(socialConfig.runtime);
  const socialRuntimeScript = asObject(socialRuntime.script);

  const webParseRules = asObject(asObject(sourceObject.web).parseRules);
  const webGather = asObject(webParseRules.gather);
  const webIntent = asObject(webGather.intent);

  const searchOptions = asObject(asObject(sourceObject.search).options);
  const searchIntent = asObject(searchOptions.intent);
  const searchDriver = asObject(searchOptions.driver);
  const searchDriverScript = asObject(searchDriver.script);

  return [
    socialIntent.recallBinding,
    socialConfig.recallBinding,
    socialRuntimeScript.recallBinding,
    socialRuntime.recallBinding,
    webIntent.recallBinding,
    webGather.recallBinding,
    searchIntent.recallBinding,
    searchOptions.recallBinding,
    searchDriverScript.recallBinding,
    searchDriver.recallBinding,
  ].some((candidate) => hasLockedRecallBinding(candidate));
}
