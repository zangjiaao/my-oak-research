import { createEmbedding } from "@oak/agents/embeddings";

type TopicTermLike = {
  type: "CORE" | "EXPANSION" | "EXCLUSION";
  value: string;
};

type TopicVectorPayload = {
  name: string;
  description?: string | null;
  terms?: TopicTermLike[];
};

const EMBEDDING_DIMENSION = 1536;

function uniq(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function buildTopicVectorInput(topic: TopicVectorPayload): string {
  const terms = topic.terms ?? [];
  const coreTerms = terms
    .filter((term) => term.type === "CORE")
    .map((term) => term.value.trim().toLowerCase());
  const expansionTerms = terms
    .filter((term) => term.type === "EXPANSION")
    .map((term) => term.value.trim().toLowerCase());

  const segments = uniq([
    topic.name,
    topic.description ?? "",
    `core:${uniq(coreTerms).join(", ")}`,
    `expansion:${uniq(expansionTerms).join(", ")}`,
  ]);
  return segments.join("\n");
}

export function toVectorLiteral(values: number[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    return `[${Array.from({ length: EMBEDDING_DIMENSION }, () => "0").join(",")}]`;
  }
  return `[${values.join(",")}]`;
}

export async function refreshTopicVector(
  tx: {
    topic: {
      findUnique: (args: unknown) => Promise<any>;
    };
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  },
  topicId: string
) {
  const topic = await tx.topic.findUnique({
    where: { id: topicId },
    include: { terms: true },
  });
  if (!topic) {
    return;
  }

  const vectorInput = buildTopicVectorInput({
    name: topic.name,
    description: topic.description,
    terms: topic.terms,
  });
  const embedding = await createEmbedding(vectorInput);
  const vectorLiteral = toVectorLiteral(embedding);
  await tx.$executeRawUnsafe(
    `UPDATE "Topic" SET "vector" = $1::vector WHERE "id" = $2`,
    vectorLiteral,
    topicId
  );
}
