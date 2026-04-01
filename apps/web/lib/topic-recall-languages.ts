export const TOPIC_RECALL_LANGUAGE_VALUES = ["zh", "en", "ja"] as const;

export type TopicRecallLanguage = (typeof TOPIC_RECALL_LANGUAGE_VALUES)[number];

export const DEFAULT_TOPIC_RECALL_LANGUAGES: TopicRecallLanguage[] = [
  "zh",
  "en",
  "ja",
];

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeTopicRecallLanguages(input: unknown): TopicRecallLanguage[] {
  const raw = Array.isArray(input) ? input : [];
  const normalized = Array.from(
    new Set(
      raw
        .map((item) => String(item).trim().toLowerCase())
        .filter((item): item is TopicRecallLanguage =>
          TOPIC_RECALL_LANGUAGE_VALUES.includes(item as TopicRecallLanguage)
        )
    )
  );
  return normalized.length > 0
    ? normalized
    : [...DEFAULT_TOPIC_RECALL_LANGUAGES];
}

export function extractTopicRecallLanguages(profile: unknown): TopicRecallLanguage[] {
  const profileObject = asObject(profile);
  return normalizeTopicRecallLanguages(profileObject?.recallLanguages);
}

export function mergeTopicProfileRecallLanguages(
  profile: unknown,
  recallLanguages: unknown
): Record<string, unknown> {
  const profileObject = asObject(profile);
  return {
    ...(profileObject ?? {}),
    recallLanguages: normalizeTopicRecallLanguages(recallLanguages),
  };
}
