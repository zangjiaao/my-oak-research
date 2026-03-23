type JsonObject = Record<string, unknown>;

export type NormalizedMediaType = "image" | "audio" | "video" | "file";

export type NormalizedMedia = {
  type: NormalizedMediaType;
  url: string;
  mimeType: string | null;
  name: string | null;
  size: number | null;
  duration: number | null;
  thumbnailUrl: string | null;
};

export type NormalizedRecordContent = {
  summaryView: {
    title: string;
    summary: string;
    source: string;
    ingestedAt: string;
    previewMediaType: NormalizedMediaType | "text";
    mediaCount: number;
  };
  detailView: {
    title: string;
    author: string | null;
    content: string;
    markdown: string;
    publishedAt: string;
    links: string[];
    images: string[];
    audios: string[];
    files: string[];
  };
  media: NormalizedMedia[];
  relation: {
    recordId: string | null;
    recordType: string | null;
    threadId: string | null;
    parentId: string | null;
    recordIndex: number | null;
    relatedKey: string;
  };
  raw: JsonObject;
  schemaVersion: "content.v2";
};

type NormalizationInput = {
  platform: string;
  intent?: string | null;
  sourceId: string;
  fallbackTitle: string;
  fallbackSummary: string;
  fallbackMarkdown: string;
  fallbackUrl?: string;
  fallbackTimeIso: string;
  recordId?: string;
  recordType?: string;
  recordIndex?: number;
  rawRecordContent?: Record<string, unknown>;
};

type FieldRule = {
  title: readonly string[];
  summary: readonly string[];
  content: readonly string[];
  author: readonly string[];
  time: readonly string[];
  links: readonly string[];
  images: readonly string[];
  audios: readonly string[];
  files: readonly string[];
  threadId: readonly string[];
  parentId: readonly string[];
};

const DEFAULT_RULE: FieldRule = {
  title: ["title", "headline", "name", "keyword", "word"],
  summary: ["summary", "snippet", "description", "text", "content", "body"],
  content: ["markdown", "content", "text", "body", "description", "snippet"],
  author: ["author", "screen_name", "user", "username", "channel", "speaker", "company"],
  time: ["published_at", "created_at", "publishDate", "timestamp", "time", "date"],
  links: ["url", "link", "source_url", "search_url", "profile_url", "permalink"],
  images: ["image", "images", "cover", "thumbnail", "picture", "pics"],
  audios: ["audio", "audios", "voice", "voices", "podcast"],
  files: ["file", "files", "attachment", "attachments", "document", "documents"],
  threadId: ["thread_id", "threadId", "conversation_id", "conversationId"],
  parentId: ["parent_id", "parentId", "reply_to_id", "in_reply_to_id"],
};

const PLATFORM_RULES: Record<string, Partial<FieldRule>> = {
  X: {
    content: ["text", "markdown", "content"],
    author: ["author", "screen_name", "name"],
    threadId: ["conversation_id", "thread_id"],
    parentId: ["in_reply_to_status_id", "reply_to_id", "parent_id"],
  },
  REDDIT: {
    content: ["body", "text", "content", "selftext"],
    author: ["author", "username"],
    threadId: ["link_id", "thread_id"],
    parentId: ["parent_id"],
  },
  WEIBO: {
    content: ["text", "content", "markdown"],
    author: ["screen_name", "author", "user"],
    threadId: ["mblogid", "thread_id"],
    parentId: ["reply_to_id", "parent_id"],
  },
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

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function collectValuesByKey(objectValue: JsonObject, key: string): string[] {
  const raw = objectValue[key];
  if (raw == null) return [];
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const text = toStringValue(raw);
    return text ? [text] : [];
  }
  if (Array.isArray(raw)) {
    const values: string[] = [];
    for (const item of raw) {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        const text = toStringValue(item);
        if (text) values.push(text);
      } else if (item && typeof item === "object") {
        const nested = item as JsonObject;
        const nestedValues = [
          toStringValue(nested.url),
          toStringValue(nested.src),
          toStringValue(nested.href),
          toStringValue(nested.path),
          toStringValue(nested.name),
          toStringValue(nested.title),
        ].filter((entry): entry is string => Boolean(entry));
        values.push(...nestedValues);
      }
    }
    return values;
  }
  if (raw && typeof raw === "object") {
    const nested = raw as JsonObject;
    return [
      toStringValue(nested.url),
      toStringValue(nested.src),
      toStringValue(nested.href),
      toStringValue(nested.path),
      toStringValue(nested.name),
      toStringValue(nested.title),
    ].filter((entry): entry is string => Boolean(entry));
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
  const values: string[] = [];
  for (const key of keys) {
    values.push(...collectValuesByKey(recordContent, key));
  }
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveRule(platform: string): FieldRule {
  const override = PLATFORM_RULES[platform.toUpperCase()] ?? {};
  return {
    title: override.title ?? DEFAULT_RULE.title,
    summary: override.summary ?? DEFAULT_RULE.summary,
    content: override.content ?? DEFAULT_RULE.content,
    author: override.author ?? DEFAULT_RULE.author,
    time: override.time ?? DEFAULT_RULE.time,
    links: override.links ?? DEFAULT_RULE.links,
    images: override.images ?? DEFAULT_RULE.images,
    audios: override.audios ?? DEFAULT_RULE.audios,
    files: override.files ?? DEFAULT_RULE.files,
    threadId: override.threadId ?? DEFAULT_RULE.threadId,
    parentId: override.parentId ?? DEFAULT_RULE.parentId,
  };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function inferMediaType(url: string): NormalizedMediaType {
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i.test(url)) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(url)) return "audio";
  if (/\.(mp4|mov|mkv|webm|avi)(\?|$)/i.test(url)) return "video";
  return "file";
}

function inferMimeType(type: NormalizedMediaType): string | null {
  switch (type) {
    case "image":
      return "image/*";
    case "audio":
      return "audio/*";
    case "video":
      return "video/*";
    default:
      return null;
  }
}

function buildRelatedKey(sourceId: string, recordId: string | null): string {
  if (recordId && recordId.trim()) {
    return `${sourceId}:${recordId.trim()}`;
  }
  return `${sourceId}:unknown`;
}

export function buildNormalizedRecordContent(
  input: NormalizationInput
): NormalizedRecordContent {
  const rule = resolveRule(input.platform);
  const rawRecordContent = asObject(input.rawRecordContent);

  const title = pickFirst(rawRecordContent, rule.title) ?? input.fallbackTitle;
  const summary =
    (input.fallbackSummary && input.fallbackSummary.trim()
      ? input.fallbackSummary.trim()
      : null) ??
    pickFirst(rawRecordContent, rule.summary) ??
    input.fallbackSummary;
  const content = pickFirst(rawRecordContent, rule.content) ?? input.fallbackMarkdown;
  const detailMarkdown =
    title && content && !content.toLowerCase().startsWith(title.toLowerCase())
      ? `# ${title}\n\n${content}`
      : content;
  const author = pickFirst(rawRecordContent, rule.author);

  const publishedRaw = pickFirst(rawRecordContent, rule.time);
  const publishedAt = publishedRaw && !Number.isNaN(new Date(publishedRaw).getTime())
    ? new Date(publishedRaw).toISOString()
    : input.fallbackTimeIso;

  const links = Array.from(
    new Set(
      [...pickMany(rawRecordContent, rule.links), ...(input.fallbackUrl ? [input.fallbackUrl] : [])]
        .filter((value) => isHttpUrl(value))
    )
  );

  const imageUrls = pickMany(rawRecordContent, rule.images).filter(isHttpUrl);
  const audioUrls = pickMany(rawRecordContent, rule.audios).filter(isHttpUrl);
  const fileUrls = pickMany(rawRecordContent, rule.files).filter(isHttpUrl);

  const mediaSeed = Array.from(new Set([...imageUrls, ...audioUrls, ...fileUrls]));
  const media: NormalizedMedia[] = mediaSeed.map((url) => {
    const mappedType: NormalizedMediaType =
      imageUrls.includes(url)
        ? "image"
        : audioUrls.includes(url)
          ? "audio"
          : fileUrls.includes(url)
            ? "file"
            : inferMediaType(url);

    return {
      type: mappedType,
      url,
      mimeType: inferMimeType(mappedType),
      name: null,
      size: null,
      duration: null,
      thumbnailUrl: null,
    };
  });

  const recordId =
    input.recordId && input.recordId.trim() ? input.recordId.trim() : null;
  const recordType =
    input.recordType && input.recordType.trim()
      ? input.recordType.trim()
      : input.intent && input.intent.trim()
        ? input.intent.trim()
        : null;

  const threadId = pickFirst(rawRecordContent, rule.threadId);
  const parentId = pickFirst(rawRecordContent, rule.parentId);
  const recordIndex =
    typeof input.recordIndex === "number" && Number.isFinite(input.recordIndex)
      ? input.recordIndex
      : toNumberValue(rawRecordContent.recordIndex);

  const previewMediaType = media[0]?.type ?? "text";

  return {
    summaryView: {
      title,
      summary,
      source: input.platform,
      ingestedAt: input.fallbackTimeIso,
      previewMediaType,
      mediaCount: media.length,
    },
    detailView: {
      title,
      author,
      content,
      markdown: detailMarkdown,
      publishedAt,
      links,
      images: media.filter((item) => item.type === "image").map((item) => item.url),
      audios: media.filter((item) => item.type === "audio").map((item) => item.url),
      files: media.filter((item) => item.type === "file").map((item) => item.url),
    },
    media,
    relation: {
      recordId,
      recordType,
      threadId,
      parentId,
      recordIndex: recordIndex ?? null,
      relatedKey: buildRelatedKey(input.sourceId, recordId),
    },
    raw: rawRecordContent,
    schemaVersion: "content.v2",
  };
}
