import { GoogleGenAI } from "@google/genai";

export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
export const GEMINI_GENERATION_MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-flash-lite-latest";
export const EMBEDDING_DIMENSIONS = 1536;
export const GEMINI_REQUEST_TIMEOUT_MS = readPositiveInt("GEMINI_REQUEST_TIMEOUT_MS", 20000);
export const GEMINI_MAX_OUTPUT_TOKENS = readPositiveInt("GEMINI_MAX_OUTPUT_TOKENS", 512);

type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

let client: GoogleGenAI | null = null;

function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in .env.local.");
  }

  client ??= new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_REQUEST_TIMEOUT_MS,
    },
  });
  return client;
}

export async function createEmbedding(input: string, taskType: EmbeddingTaskType) {
  const response = await getGeminiClient().models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: input,
    config: {
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
      httpOptions: {
        timeout: GEMINI_REQUEST_TIMEOUT_MS,
      },
    },
  });

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding?.length) {
    throw new Error("Gemini did not return an embedding.");
  }

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Gemini returned ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
  }

  return embedding;
}

export async function generateAnswer(query: string, context: string) {
  const response = await getGeminiClient().models.generateContent({
    model: GEMINI_GENERATION_MODEL,
    contents: `Context:\n${context}\n\nQuestion:\n${query}`,
    config: {
      temperature: 0.2,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      automaticContinuation: false,
      httpOptions: {
        timeout: GEMINI_REQUEST_TIMEOUT_MS,
      },
      systemInstruction:
        "You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know.",
    },
  });

  return response.text || "I do not know.";
}
