type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asCleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\u0000/g, "").trim();
  return cleaned || null;
}

function pickFirstText(values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asCleanString(value);
    if (normalized) return normalized;
  }
  return null;
}

export type ActiveContentStateInput = {
  title: string;
  summary: string;
  markdown: string;
  meta: unknown;
};

export type ActiveContentState = {
  activeTitle: string;
  activeSummaryHint: string;
  activeBody: string;
  activeText: string;
};

export function resolveActiveContentState(
  input: ActiveContentStateInput
): ActiveContentState {
  const meta = asObject(input.meta);
  const recordContent = asObject(meta.recordContent);
  const summaryView = asObject(recordContent.summaryView);
  const detailView = asObject(recordContent.detailView);

  const activeTitle =
    pickFirstText([
      meta.jinaTitle,
      meta.cleanedTitle,
      detailView.title,
      summaryView.title,
      input.title,
    ]) ?? "Untitled";
  const activeSummaryHint =
    pickFirstText([
      meta.jinaDescription,
      meta.cleanedSummary,
      summaryView.summary,
      input.summary,
    ]) ?? "";
  const activeBody =
    pickFirstText([
      meta.finalMaterialContent,
      meta.jinaContent,
      meta.cleanedMarkdown,
      detailView.content,
      detailView.markdown,
      recordContent.content,
      recordContent.markdown,
      input.markdown,
      input.summary,
    ]) ?? "";

  const mergedText = [activeTitle, activeSummaryHint, activeBody]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    activeTitle,
    activeSummaryHint,
    activeBody,
    activeText: mergedText,
  };
}
