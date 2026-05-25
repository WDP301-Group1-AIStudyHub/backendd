import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppError } from "../middlewares/error.middleware";

const getGeminiClient = (): GoogleGenerativeAI => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new AppError("GEMINI_API_KEY is required for RAG features", 500);
  }

  return new GoogleGenerativeAI(apiKey);
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const model = getGeminiClient().getGenerativeModel({
    model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  });

  const result = await model.embedContent(text);

  return result.embedding.values;
};

export const generateEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  const embeddings: number[][] = [];

  for (const text of texts) {
    embeddings.push(await generateEmbedding(text));
  }

  return embeddings;
};
