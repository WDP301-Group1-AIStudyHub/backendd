import Groq, { APIError, RateLimitError } from "groq-sdk";
import { ChatCompletionMessageParam } from "groq-sdk/resources/chat";
import { AppError } from "../middlewares/error.middleware";
import { retryAsync } from "../utils/retry";

const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const INSUFFICIENT_CONTEXT_ANSWER =
  "Tôi không tìm thấy thông tin này trong tài liệu đã upload.";

let groqClient: Groq | null = null;

const getGroqClient = (): Groq => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new AppError("GROQ_API_KEY is required for answer generation", 500);
  }

  if (!groqClient) {
    groqClient = new Groq({ apiKey });
  }

  return groqClient;
};

const isRetryableGroqError = (error: unknown): boolean => {
  if (error instanceof RateLimitError) {
    return true;
  }

  if (error instanceof APIError) {
    return error.status === 429 || error.status >= 500;
  }

  return false;
};

const getGroqErrorMessage = (error: unknown): string => {
  if (error instanceof APIError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Groq API error";
};

const getGroqHttpStatus = (error: unknown): number => {
  if (error instanceof RateLimitError) {
    return 429;
  }

  return 502;
};

export const generateGroqText = async (
  messages: ChatCompletionMessageParam[],
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<string> => {
  try {
    const completion = await retryAsync(
      () =>
        getGroqClient().chat.completions.create({
          model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 900,
        }),
      {
        retries: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        shouldRetry: isRetryableGroqError,
      },
    );

    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    throw new AppError(
      `Groq answer generation failed: ${getGroqErrorMessage(error)}`,
      getGroqHttpStatus(error),
    );
  }
};

export const generateGroqTextFromPrompt = async (
  prompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> =>
  generateGroqText(
    [
      {
        role: "user",
        content: prompt,
      },
    ],
    options,
  );

export const generateAnswerFromContext = async (
  question: string,
  context: string,
  strict = false,
): Promise<string> => {
  const systemMessage = [
    "Bạn là trợ lý học tập cho hệ thống RAG.",
    "Chỉ trả lời dựa trên CONTEXT được cung cấp.",
    `Nếu CONTEXT không có đủ thông tin để trả lời, hãy trả lời đúng câu: "${INSUFFICIENT_CONTEXT_ANSWER}"`,
    strict
      ? "Không suy luận ngoài CONTEXT. Mỗi ý trong câu trả lời phải được hỗ trợ trực tiếp bởi CONTEXT."
      : "Không bịa thêm thông tin ngoài tài liệu.",
  ].join(" ");

  return generateGroqText(
    [
      {
        role: "system",
        content: systemMessage,
      },
      {
        role: "user",
        content: `CONTEXT:\n${context}\n\nQUESTION:\n${question}`,
      },
    ],
    {
      temperature: 0.1,
      maxTokens: 900,
    },
  );
};
