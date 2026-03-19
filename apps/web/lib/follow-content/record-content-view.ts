import type { Content } from "@/app/generated/prisma";

type JsonObject = Record<string, unknown>;

const TITLE_KEYS = [
  "title",
  "headline",
  "name",
  "word",
  "keyword",
];

const SUMMARY_KEYS = [
  "summary",
  "snippet",
  "description",
  "content",
  "text",
  "body",
];

const AUTHOR_KEYS = [
  "author",
  "screen_name",
  "user",
  "username",
  "name",
  "speaker",
  "channel",
  "company",
];

const CONTENT_KEYS = [
  "markdown",
  "text",
  "content",
  "body",
  "description",
  "snippet",
];

const TIME_KEYS = [
  "created_at",
  "published_at",
  "publishDate",
  "time",
  "date",
  "timestamp",
  "listed",
];

const IMAGE_KEYS = [
  "image",
  "images",
  "cover",
  "cover_image",
  "thumbnail",
  "thumbnails",
  "picture",
  "pictures",
  "pics",
  "media",
];

const LINK_KEYS = [
  "url",
  "link",
  "source_url",
  "search_url",
  "profile_url",
  "permalink",
];

const SCAN_SCRIPT_FIELD_MAP = {
  summaryView: {
    title: ["title", "name", "word", "keyword"],
    summary: ["text", "content", "description", "snippet", "body"],
    source: ["source", "subreddit", "channel", "company"],
    time: ["created_at", "published_at", "time", "date", "timestamp"],
  },
  detailView: {
    title: ["title", "headline", "name"],
    author: ["author", "screen_name", "user", "username", "speaker", "channel"],
    content: ["markdown", "text", "content", "body", "description", "snippet"],
    image: IMAGE_KEYS,
    link: LINK_KEYS,
  },
} as const;

export type NormalizedSummaryView = {
  title: string;
  summary: string;
  source: string;
  ingestedAt: string;
  hasImage: boolean;
  layout: "image" | "text";
};

export type NormalizedDetailView = {
  title: string;
  author: string | null;
  content: string;
  markdown: string;
  images: string[];
  links: string[];
  sourceUrl: string | null;
  publishedAt: string;
  recordId: string | null;
  recordType: string | null;
};

export type NormalizedRelation = {
  recordId: string | null;
  recordIndex: number | null;
  relatedKey: string;
};

export type NormalizedContentViews = {
  summaryView: NormalizedSummaryView;
  detailView: NormalizedDetailView;
  relation: NormalizedRelation;
  rawRecordContent: JsonObject;
  mappingSource: typeof SCAN_SCRIPT_FIELD_MAP;
};

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function collectValuesByKey(objectValue: JsonObject, key: string): string[] {
  const raw = objectValue[key];
  if (raw == null) {
    return [];
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const value = toStringValue(raw);
    return value ? [value] : [];
  }
  if (Array.isArray(raw)) {
    const values: string[] = [];
    for (const entry of raw) {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        const value = toStringValue(entry);
        if (value) values.push(value);
      } else if (entry && typeof entry === "object") {
        const nestedObject = entry as JsonObject;
        const nestedCandidates = [
          toStringValue(nestedObject.url),
          toStringValue(nestedObject.src),
          toStringValue(nestedObject.href),
          toStringValue(nestedObject.text),
          toStringValue(nestedObject.title),
        ].filter((item): item is string => Boolean(item));
        values.push(...nestedCandidates);
      }
    }
    return values;
  }
  if (typeof raw === "object") {
    const nestedObject = raw as JsonObject;
    const nestedCandidates = [
      toStringValue(nestedObject.url),
      toStringValue(nestedObject.src),
      toStringValue(nestedObject.href),
      toStringValue(nestedObject.text),
      toStringValue(nestedObject.title),
    ].filter((item): item is string => Boolean(item));
    return nestedCandidates;
  }
  return [];
}

function pickFirst(recordContent: JsonObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const values = collectValuesByKey(recordContent, key);
    if (values.length > 0) {
      return values[0];
    }
  }
  return null;
}

function pickMany(recordContent: JsonObject, keys: readonly string[]): string[] {
  const result: string[] = [];
  for (const key of keys) {
    result.push(...collectValuesByKey(recordContent, key));
  }
  return Array.from(new Set(result.filter(Boolean)));
}

function pickPublishedAt(recordContent: JsonObject, fallbackTime: string): string {
  const raw = pickFirst(recordContent, TIME_KEYS);
  if (!raw) {
    return fallbackTime;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackTime;
  }
  return parsed.toISOString();
}

function normalizeRecordRelatedKey(content: Content, meta: JsonObject, recordId: string | null): string {
  const sourceId = toStringValue(meta.sourceId) ?? content.platform ?? "unknown";
  if (recordId) {
    const cleaned = recordId.replace(/[-_](comment|reply|repost|quote)\d*$/i, "");
    return `${sourceId}:${cleaned || recordId}`;
  }
  return `${sourceId}:content:${content.id}`;
}

export function buildRecordContentViews(content: Content): NormalizedContentViews {
  const meta = asObject(content.meta);
  const recordContent = asObject(meta.recordContent);
  const recordId = toStringValue(meta.recordId);
  const recordType = toStringValue(meta.recordType);
  const recordIndexRaw = meta.recordIndex;
  const recordIndex =
    typeof recordIndexRaw === "number" && Number.isFinite(recordIndexRaw)
      ? recordIndexRaw
      : null;
  const contentTitle =
    pickFirst(recordContent, TITLE_KEYS) ??
    (content.title && content.title.trim() ? content.title.trim() : "Untitled");
  const contentSummary =
    pickFirst(recordContent, SUMMARY_KEYS) ??
    (content.summary && content.summary.trim() ? content.summary.trim() : "");
  const contentMarkdown =
    pickFirst(recordContent, ["markdown"]) ??
    (content.markdown && content.markdown.trim() ? content.markdown.trim() : "");
  const contentBody =
    pickFirst(recordContent, CONTENT_KEYS) ??
    contentMarkdown ||
    contentSummary ||
    "No content available";
  const images = pickMany(recordContent, IMAGE_KEYS).filter((value) =>
    /^https?:\/\//i.test(value)
  );
  const links = [
    ...pickMany(recordContent, LINK_KEYS).filter((value) => /^https?:\/\//i.test(value)),
    ...(content.url ? [content.url] : []),
  ];
  const sourceUrl = links[0] ?? null;
  const publishedAt = pickPublishedAt(recordContent, content.time.toISOString());
  const author = pickFirst(recordContent, AUTHOR_KEYS);

  return {
    summaryView: {
      title: contentTitle,
      summary: contentSummary || content.summary || contentBody,
      source: content.platform,
      ingestedAt: content.time.toISOString(),
      hasImage: images.length > 0,
      layout: images.length > 0 ? "image" : "text",
    },
    detailView: {
      title: contentTitle,
      author,
      content: contentBody,
      markdown: contentMarkdown || content.markdown || contentBody,
      images,
      links: Array.from(new Set(links)),
      sourceUrl,
      publishedAt,
      recordId,
      recordType,
    },
    relation: {
      recordId,
      recordIndex,
      relatedKey: normalizeRecordRelatedKey(content, meta, recordId),
    },
    rawRecordContent: recordContent,
    mappingSource: SCAN_SCRIPT_FIELD_MAP,
  };
}
