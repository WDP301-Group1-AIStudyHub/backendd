import Groq, { APIError, RateLimitError } from "groq-sdk";
import { ChatCompletionMessageParam } from "groq-sdk/resources/chat";
import { AppError } from "../middlewares/error.middleware";
import {
  detectAnswerStyle,
  AnswerLanguage,
  getInsufficientContextAnswer,
} from "../utils/answerStyle";
import { retryAsync } from "../utils/retry";
import type { SemanticQuestionIntent } from "./intentClassifier.service";

const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

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

const removeRepeatedLines = (answer: string): string => {
  const seen = new Set<string>();

  return answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }

      const normalized = line.toLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .join("\n")
    .trim();
};

const countSentences = (answer: string): number => {
  const matches = answer.match(/[^.!?。！？]+[.!?。！？]+/g);

  return matches?.length ?? (answer.trim() ? 1 : 0);
};

const cleanupAnswer = (answer: string): string =>
  removeRepeatedLines(answer.replace(/^["']|["']$/g, "").trim());

const parseJsonObject = <T>(text: string): T | null => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
};

const formatExtractedEntities = (
  entities: string[],
  language: AnswerLanguage,
): string => {
  const uniqueEntities = [...new Set(entities.map((entity) => entity.trim()))]
    .filter(Boolean);

  if (uniqueEntities.length === 0) {
    return "";
  }

  if (uniqueEntities.length === 1) {
    return `${uniqueEntities[0]}.`;
  }

  const conjunction = language === "Vietnamese" ? " và " : " and ";
  const lastEntity = uniqueEntities[uniqueEntities.length - 1];
  const leadingEntities = uniqueEntities.slice(0, -1).join(", ");

  return `${leadingEntities}${conjunction}${lastEntity}.`;
};

const compressShortAnswer = async (
  question: string,
  answer: string,
): Promise<string> => {
  const style = detectAnswerStyle(question);

  const compressed = await generateGroqText(
    [
      {
        role: "system",
        content: [
          "Compress the answer without adding new facts.",
          `Write in ${style.language}.`,
          "Return only the compressed answer.",
          "Maximum 2 sentences.",
        ].join(" "),
      },
      {
        role: "user",
        content: `QUESTION:\n${question}\n\nANSWER:\n${answer}`,
      },
    ],
    {
      temperature: 0,
      maxTokens: 100,
    },
  );

  return cleanupAnswer(compressed || answer);
};

export const generateAnswerFromContext = async (
  question: string,
  context: string,
  strict = false,
  options: {
    intent?: SemanticQuestionIntent;
  } = {},
): Promise<string> => {
  const style = detectAnswerStyle(question);
  const intent = options.intent ?? "unknown";
  const conciseAnswer = intent === "extraction" || style.wantsShortAnswer;
  const maxSentencesRule = style.wantsShortAnswer
    ? "Maximum 2 sentences."
    : "Use the shortest complete answer that satisfies the question.";
  const insufficientContextAnswer = getInsufficientContextAnswer(style.language);
  const systemMessage = [
    // This prompt is document-type independent. It follows the user's task and
    // the retrieved context instead of assuming a specific document domain.
    "You are the answer generation layer in a RAG system.",
    style.language === "other"
      ? "Answer in the same language as the user's question."
      : `Answer in ${style.language}, matching the user's question language.`,
    "Answer only using the provided CONTEXT.",
    "Follow the user's requested format exactly.",
    intent === "list" ? "The user wants a list; use a concise list." : "",
    "Do not add explanations unless the user asks for them.",
    "Do not add unrelated information.",
    "Do not hallucinate. Do not repeat.",
    maxSentencesRule,
    `If the CONTEXT is insufficient, answer exactly: "${insufficientContextAnswer}"`,
    intent === "extraction"
      ? "Intent: extraction. Extract only the requested information. No long paragraphs. Prefer a compact comma-separated or natural-language list when appropriate."
      : `Intent: ${intent}.`,
    strict
      ? "Strict mode: every answer item must be directly supported by CONTEXT."
      : "If multiple chunks contain extra information, ignore anything outside the user's requested scope.",
    conciseAnswer
      ? "The user asked for a concise answer. Return only the final answer, with no preface."
      : "Return the final answer directly.",
  ]
    .filter(Boolean)
    .join(" ");

  const answer = await generateGroqText(
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
      maxTokens: conciseAnswer ? 120 : 700,
    },
  );

  const cleanedAnswer = cleanupAnswer(answer);

  if (style.wantsShortAnswer && countSentences(cleanedAnswer) > 2) {
    return compressShortAnswer(question, cleanedAnswer);
  }

  return cleanedAnswer;
};

export const generateEntityExtractionAnswer = async (
  question: string,
  context: string,
): Promise<string> => {
  const style = detectAnswerStyle(question);
  const insufficientContextAnswer = getInsufficientContextAnswer(style.language);
  const extraction = await generateGroqText(
    [
      {
        role: "system",
        content: [
          "You are a strict entity extraction engine for a RAG system.",
          "Use only the provided CONTEXT.",
          "Return valid JSON only. Do not wrap it in markdown.",
          "Expected JSON shape: {\"entities\":[\"string\"]}.",
          "Extract only entities requested by the user.",
          "If no requested entities are present, return {\"entities\":[]}.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        role: "user",
        content: `CONTEXT:\n${context}\n\nQUESTION:\n${question}`,
      },
    ],
    {
      temperature: 0,
      maxTokens: 180,
    },
  );
  const parsed = parseJsonObject<{ entities?: unknown[] }>(extraction);
  const entities =
    parsed?.entities
      ?.filter((entity): entity is string => typeof entity === "string")
      .map((entity) => entity.trim()) ?? [];
  const answer = formatExtractedEntities(entities, style.language);

  return answer || insufficientContextAnswer;
};
