import OpenAI from "openai";

type EmbeddingModel =
  | "Doubao-embedding-240715"
  | "text-embedding-ada-002"
  | string;

const MODEL_MAP: Record<EmbeddingModel, string> = {
  "Doubao-embedding-240715": "text-embedding-ada-002",
  "text-embedding-ada-002": "text-embedding-ada-002",
};

const DEFAULT_MODEL: EmbeddingModel =
  (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? "Doubao-embedding-240715";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function resolveModel(model: EmbeddingModel) {
  return MODEL_MAP[model] ?? model;
}

function zeros(dim = 1536) {
  return Array.from({ length: dim }, () => 0);
}

export async function createEmbeddings(
  inputs: string[],
  model: EmbeddingModel = DEFAULT_MODEL
): Promise<number[][]> {
  console.log(`[embeddings] createEmbeddings called with model=${model}, inputs=${inputs.length}`);
  const client = getOpenAIClient();
  if (!client) {
    console.log("[embeddings] OpenAI API key missing, returning zero vectors");
    return inputs.map(() => zeros());
  }

  const response = await client.embeddings.create({
    model: resolveModel(model),
    input: inputs,
  });

  console.log(
    `[embeddings] received ${response.data.length} embeddings from ${resolveModel(model)}`
  );

  return response.data.map((item) => item.embedding);
}

export async function createEmbedding(
  input: string,
  model?: EmbeddingModel
): Promise<number[]> {
  const [embedding] = await createEmbeddings(
    [input],
    model ?? DEFAULT_MODEL
  );
  return embedding;
}
