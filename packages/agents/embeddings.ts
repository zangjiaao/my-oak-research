import { embedMany } from "ai";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openai, deepseek, google } from "./provider";

type EmbeddingModel =
  | "text-embedding-ada-002"
  | "text-embedding-3-small"
  | "text-embedding-3-large"
  | string;

type EmbeddingProvider = "openai" | "google" | "deepseek" | "local_gguf";

const DEFAULT_MODEL: EmbeddingModel =
  (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? "text-embedding-3-small";
const DEFAULT_PROVIDER = (process.env.EMBEDDING_PROVIDER ??
  "openai") as EmbeddingProvider;
const DEFAULT_EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIM ?? 1536);
const LOCAL_GGUF_CACHE_DIR = process.env.LOCAL_EMBED_CACHE_DIR?.trim()
  ? resolve(process.env.LOCAL_EMBED_CACHE_DIR.trim())
  : resolve(homedir(), ".cache/oak/models");
const LOCAL_GGUF_MODEL = process.env.LOCAL_EMBED_MODEL?.trim() ?? "";
const LOCAL_GGUF_BATCH_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.LOCAL_EMBED_BATCH_SIZE ?? 16))
);

/**
 * Select the correct embedding model instance based on string identifier
 */
function getEmbeddingModel(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.includes("gemini") || lower.includes("embedding-004")) {
    return google.embedding(modelId);
  }
  // DeepSeek currently doesn't provide an official embedding API in many regions, 
  // but if it uses OpenAI compatible endpoint:
  if (lower.includes("deepseek")) {
    return deepseek.embedding(modelId);
  }
  return openai.embedding(modelId);
}

function resolveEmbeddingProvider(modelId: string): EmbeddingProvider {
  const provider = DEFAULT_PROVIDER.toLowerCase();
  if (provider === "local_gguf") {
    return "local_gguf";
  }
  const lower = modelId.toLowerCase();
  if (lower.includes("gemini") || lower.includes("embedding-004")) {
    return "google";
  }
  if (lower.includes("deepseek")) {
    return "deepseek";
  }
  return "openai";
}

// OpenAI embedding models have a limit of 8192 tokens.
// We use a character limit as a safety proxy. 
// 12000 characters is generally safe for both English and Chinese.
const MAX_INPUT_CHARS = 12000;

function zeros(dim = DEFAULT_EMBEDDING_DIMENSION) {
  return Array.from({ length: dim }, () => 0);
}

function normalizeDimension(input: number[], targetDim = DEFAULT_EMBEDDING_DIMENSION): number[] {
  if (!Array.isArray(input) || input.length === 0) {
    return zeros(targetDim);
  }
  if (input.length === targetDim) return input;
  if (input.length > targetDim) {
    return input.slice(0, targetDim);
  }
  return [...input, ...Array.from({ length: targetDim - input.length }, () => 0)];
}

type LocalEmbeddingEngine = {
  embed: (text: string) => Promise<number[]>;
};

const localEngineCache = new Map<string, Promise<LocalEmbeddingEngine>>();

function toHfDownloadUrl(modelRef: string): string {
  const normalized = modelRef.slice(3);
  const segments = normalized.split("/");
  if (segments.length < 3) {
    throw new Error(
      `Invalid LOCAL_EMBED_MODEL hf reference: ${modelRef}. Expected hf:org/repo/file.gguf`
    );
  }
  const [org, repo, ...fileParts] = segments;
  const file = fileParts.join("/");
  return `https://huggingface.co/${org}/${repo}/resolve/main/${file}`;
}

async function ensureLocalModelPath(modelId: string): Promise<string> {
  if (!modelId) {
    throw new Error(
      "LOCAL_EMBED_MODEL is empty. Set EMBEDDING_PROVIDER=local_gguf and LOCAL_EMBED_MODEL."
    );
  }
  if (!modelId.startsWith("hf:")) {
    return resolve(modelId);
  }
  mkdirSync(LOCAL_GGUF_CACHE_DIR, { recursive: true });
  const downloadUrl = toHfDownloadUrl(modelId);
  const filenameHash = createHash("sha1").update(modelId).digest("hex").slice(0, 12);
  const filename = `${basename(downloadUrl)}.${filenameHash}.gguf`;
  const filePath = resolve(LOCAL_GGUF_CACHE_DIR, filename);
  if (existsSync(filePath)) {
    return filePath;
  }
  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download LOCAL_EMBED_MODEL from HuggingFace: ${response.status} ${response.statusText}`
    );
  }
  const output = createWriteStream(filePath);
  await pipeline(Readable.fromWeb(response.body as any), output);
  return filePath;
}

async function createNodeLlamaLocalEngine(modelId: string): Promise<LocalEmbeddingEngine> {
  let llamaModule: any;
  try {
    llamaModule = (await import("node-llama-cpp")) as any;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot load node-llama-cpp. Install it first with: npm install --workspace @oak/agents node-llama-cpp. Original error: ${message}`
    );
  }
  const getLlama =
    llamaModule?.getLlama ??
    llamaModule?.default?.getLlama;
  if (typeof getLlama !== "function") {
    throw new Error(
      "node-llama-cpp getLlama not found. Please install node-llama-cpp and ensure runtime supports GGUF."
    );
  }
  const modelPath = await ensureLocalModelPath(modelId);
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const embeddingContext =
    typeof model?.createEmbeddingContext === "function"
      ? await model.createEmbeddingContext()
      : null;
  if (!embeddingContext || typeof embeddingContext.getEmbeddingFor !== "function") {
    throw new Error(
      "Loaded GGUF model does not expose embedding context. Use an embedding-capable GGUF model."
    );
  }
  const parseEmbedding = (result: any): number[] => {
    if (Array.isArray(result)) return result as number[];
    if (Array.isArray(result?.vector)) return result.vector as number[];
    if (Array.isArray(result?.embedding)) return result.embedding as number[];
    throw new Error("Unknown embedding result shape from node-llama-cpp.");
  };
  return {
    embed: async (text: string) => {
      const result = await embeddingContext.getEmbeddingFor(text);
      return parseEmbedding(result);
    },
  };
}

async function getLocalEngine(modelId: string): Promise<LocalEmbeddingEngine> {
  const cacheKey = modelId.trim();
  let entry = localEngineCache.get(cacheKey);
  if (!entry) {
    entry = createNodeLlamaLocalEngine(cacheKey);
    localEngineCache.set(cacheKey, entry);
  }
  return entry;
}

async function createLocalEmbeddings(
  inputs: string[],
  model: EmbeddingModel
): Promise<number[][]> {
  const modelId = LOCAL_GGUF_MODEL || String(model);
  const engine = await getLocalEngine(modelId);
  const embeddings: number[][] = [];
  for (let start = 0; start < inputs.length; start += LOCAL_GGUF_BATCH_SIZE) {
    const batch = inputs.slice(start, start + LOCAL_GGUF_BATCH_SIZE);
    for (const input of batch) {
      const normalized = input.length > MAX_INPUT_CHARS
        ? input.slice(0, MAX_INPUT_CHARS)
        : input;
      const vector = await engine.embed(normalized);
      embeddings.push(normalizeDimension(vector));
    }
  }
  return embeddings;
}

export async function createEmbeddings(
  inputs: string[],
  model: EmbeddingModel = DEFAULT_MODEL
): Promise<number[][]> {
  const provider = resolveEmbeddingProvider(String(model));
  console.log(
    `[embeddings] createEmbeddings called with provider=${provider}, model=${model}, dim=${DEFAULT_EMBEDDING_DIMENSION}, inputs=${inputs.length}`
  );

  try {
    if (provider === "local_gguf") {
      return await createLocalEmbeddings(inputs, model);
    }

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
        model: getEmbeddingModel(model),
        values: batch,
      });

      // Insert back into the correct positions
      for (let j = 0; j < embeddings.length; j++) {
        allEmbeddings[startIndex + j] = normalizeDimension(embeddings[j]);
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
