import Groq, { APIError, RateLimitError } from "groq-sdk";
import { ChatCompletionMessageParam } from "groq-sdk/resources/chat";
import { AppError } from "../middlewares/error.middleware";
import {
  detectAnswerStyle,
  AnswerLanguage,
} from "../utils/answerStyle";
import type { AnswerProfile } from "../utils/answerProfile";
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
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (!line) {
        return true;
      }

      const normalized = line.toLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
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
          "If writing Vietnamese, preserve Vietnamese accents and educational terms.",
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
    answerProfile?: AnswerProfile;
  } = {},
): Promise<string> => {
  const style = detectAnswerStyle(question);
  const intent = options.intent ?? "unknown";
  const answerProfile = options.answerProfile ?? "standard";
  const wantsDetailedAnswer = answerProfile === "detailed";
  const conciseAnswer = intent === "extraction" || style.wantsShortAnswer;
  const maxSentencesRule = wantsDetailedAnswer
    ? "Use enough detail for study notes. Prefer structured Markdown over a single paragraph."
    : style.wantsShortAnswer
    ? "Maximum 2 sentences."
    : intent === "summary" || intent === "comparison" || intent === "qa"
      ? "Use 3-6 sentences with enough detail to be useful."
      : "Use 2-4 complete sentences with sufficient detail.";
  const formatRule = wantsDetailedAnswer
    ? [
        "Format the answer in Markdown with these sections when useful:",
        "## Tóm tắt ngắn",
        "## Ý chính",
        "## Nội dung chi tiết",
        "## Điểm cần nhớ",
        "## Nguồn/section liên quan",
        "Use bullets and short paragraphs. Keep every point grounded in CONTEXT.",
      ].join(" ")
    : "Use simple Markdown only if it improves readability.";
  const systemMessage = [
    "You are the answer generation layer in a RAG system for Vietnamese educational documents.",
    style.language === "other"
      ? "Answer in the same language as the user's question."
      : `Answer in ${style.language}, matching the user's question language.`,
    "If the user asks in Vietnamese, answer in Vietnamese.",
    "Preserve Vietnamese accents and subject-specific educational terms.",
    "Do not translate Vietnamese educational terms unnecessarily.",
    "Answer only using the provided CONTEXT.",
    "Follow the user's requested format exactly.",
    intent === "list" ? "The user wants a list; use a concise list." : "",
    "Give a complete answer based on context, not a fragment.",
    "If the question asks whether the document is related to another topic (for example, a different subject area):",
    "1) Judge relation strictly from CONTEXT.",
    "2) If not related, state clearly that the document is not related to that topic.",
    "3) Then provide a full but concise summary of the document's main content from CONTEXT (key ideas + supporting points).",
    "Do not add unrelated information.",
    "Do not hallucinate. Do not repeat.",
    maxSentencesRule,
    formatRule,
    "If the CONTEXT is insufficient, return an empty response instead of guessing.",
    intent === "extraction"
      ? "Intent: extraction. Extract only the requested information. No long paragraphs. Prefer a compact comma-separated or natural-language list when appropriate."
      : `Intent: ${intent}.`,
    intent === "summary"
      ? "For summaries, include key ideas and important details from the relevant section(s)."
      : "",
    intent === "qa"
      ? "For normal questions, include the direct answer and 1-3 supporting details from context when available."
      : "",
    intent === "qa"
      ? "For relation-check questions that are out-of-scope, include the not-related verdict and a structured summary of what the document is actually about."
      : "",
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
      maxTokens: conciseAnswer ? 120 : wantsDetailedAnswer ? 1800 : 900,
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
  const extraction = await generateGroqText(
    [
      {
        role: "system",
        content: [
          "You are a strict entity extraction engine for a RAG system.",
          "The system focuses on Vietnamese educational documents.",
          "Use only the provided CONTEXT.",
          "If the user asks in Vietnamese, preserve Vietnamese accents and terms.",
          "Do not translate Vietnamese educational terms unnecessarily.",
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

  return answer;
};
