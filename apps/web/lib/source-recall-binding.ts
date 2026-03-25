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

function hasLockedRecallBindingForIntent(input: {
  recallBinding: unknown;
  args: unknown;
}): boolean {
  if (!hasLockedRecallBinding(input.recallBinding)) return false;

  const intentArgs = asObject(input.args);
  const argKeys = toStringArray(asObject(input.recallBinding).argKeys);
  if (argKeys.length === 0) return false;

  const intentArgKeys = new Set(Object.keys(intentArgs).map((key) => key.trim()).filter(Boolean));
  return argKeys.some((key) => intentArgKeys.has(key));
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
    hasLockedRecallBindingForIntent({
      recallBinding: socialIntent.recallBinding,
      args: socialIntent.args,
    }),
    hasLockedRecallBindingForIntent({
      recallBinding: webIntent.recallBinding,
      args: webIntent.args ?? webGather.intentArgs,
    }),
    hasLockedRecallBindingForIntent({
      recallBinding: searchIntent.recallBinding,
      args: searchIntent.args ?? searchOptions.intentArgs,
    }),
  ].some(Boolean);
}
