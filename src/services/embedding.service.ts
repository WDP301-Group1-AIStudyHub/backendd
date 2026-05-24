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
    model: process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004",
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

export const generateAnswerFromContext = async (
  question: string,
  context: string,
): Promise<string> => {
  const model = getGeminiClient().getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  });

  const prompt = `
Bạn là trợ lý học tập. Chỉ trả lời dựa trên phần CONTEXT bên dưới.
Nếu CONTEXT không có đủ thông tin để trả lời, hãy trả lời đúng câu:
"Tôi không tìm thấy thông tin này trong tài liệu đã upload."

CONTEXT:
${context}

QUESTION:
${question}
`;

  const result = await model.generateContent(prompt);

  return result.response.text().trim();
};
