import { embedMany } from "ai";
import { openai, apiKey } from "./provider";

type EmbeddingModel =
  | "text-embedding-ada-002"
  | "text-embedding-3-small"
  | "text-embedding-3-large"
  | string;

const DEFAULT_MODEL: EmbeddingModel =
  (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? "text-embedding-3-small";

// OpenAI embedding models have a limit of 8192 tokens.
// We use a character limit as a safety proxy. 
// 12000 characters is generally safe for both English and Chinese.
const MAX_INPUT_CHARS = 12000;

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
    const BATCH_SIZE = 100;
    const CONCURRENCY = 2;  // Reduced from 5 to 2 to stay under TPM limits
    const allEmbeddings: number[][] = new Array(inputs.length);

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const processBatch = async (startIndex: number) => {
      const endIndex = Math.min(startIndex + BATCH_SIZE, inputs.length);
      const batch = inputs.slice(startIndex, endIndex).map(v => {
        if (v.length > MAX_INPUT_CHARS) {
          console.warn(`[embeddings] Data too long (${v.length} chars), truncating to ${MAX_INPUT_CHARS}`);
          return v.slice(0, MAX_INPUT_CHARS);
        }
        return v;
      });

      console.log(`[embeddings] processing batch ${Math.floor(startIndex / BATCH_SIZE) + 1}/${Math.ceil(inputs.length / BATCH_SIZE)}...`);

      const { embeddings } = await embedMany({
        model: openai.embedding(model),
        values: batch,
      });

      // Insert back into the correct positions
      for (let j = 0; j < embeddings.length; j++) {
        allEmbeddings[startIndex + j] = embeddings[j];
      }
    };

    // Process in paralleled chunks with a small sleep between cycles
    for (let i = 0; i < inputs.length; i += BATCH_SIZE * CONCURRENCY) {
      const batchPromises = [];
      for (let j = 0; j < CONCURRENCY; j++) {
        const startIndex = i + j * BATCH_SIZE;
        if (startIndex < inputs.length) {
          batchPromises.push(processBatch(startIndex));
        }
      }
      await Promise.all(batchPromises);
      if (i + BATCH_SIZE * CONCURRENCY < inputs.length) {
        await sleep(1000); // 1 second delay between parallel cycles
      }
    }

    console.log(
      `[embeddings] successfully received ${allEmbeddings.length} embeddings`
    );

    return allEmbeddings;
  } catch (error: any) {
    console.error(`[embeddings] Error creating embeddings:`, error.message);
    if (error.message?.includes("context length")) {
      console.error("[embeddings] Token limit exceeded. Please check chunking logic.");
    }
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
