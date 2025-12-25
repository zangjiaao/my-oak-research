import { embedMany } from "ai";
import { openai, apiKey } from "./provider";

type EmbeddingModel =
  | "text-embedding-ada-002"
  | string;

const DEFAULT_MODEL: EmbeddingModel =
  (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? "text-embedding-ada-002";

function zeros(dim = 1536) {
  return Array.from({ length: dim }, () => 0);
}


export async function createEmbeddings(
  inputs: string[],
  model: EmbeddingModel = DEFAULT_MODEL
): Promise<number[][]> {
  console.log(
    `[embeddings] createEmbeddings (AI SDK) called with model=${model}, inputs=${inputs.length}`
  );

  if (!apiKey) {
    console.log("[embeddings] No API key found, returning zero vectors");
    return inputs.map(() => zeros());
  }

  try {
    const BATCH_SIZE = 10; // 每组只处理 10 个 chunk，确保即便 chunk 很大也不会超过 300k token
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const batch = inputs.slice(i, i + BATCH_SIZE);
      console.log(`[embeddings] processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(inputs.length / BATCH_SIZE)}...`);

      const { embeddings } = await embedMany({
        model: openai.embedding(model),
        values: batch,
      });

      allEmbeddings.push(...embeddings);
    }

    console.log(
      `[embeddings] successfully received ${allEmbeddings.length} embeddings`
    );

    return allEmbeddings;
  } catch (error: any) {
    console.error(`[embeddings] Error creating embeddings:`, error.message);
    throw error;
  }
}

export async function createEmbedding(
  input: string,
  model?: EmbeddingModel
): Promise<number[]> {
  const [embedding] = await createEmbeddings([input], model ?? DEFAULT_MODEL);
  return embedding;
}
