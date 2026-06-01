import { ChatHistory, IChatHistory } from "../models/chatHistory.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatHistoryListResponse,
  ChatHistoryResponse,
} from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import { askQuestionWithCorrectiveRag } from "./correctiveRag.service";
import { createEvaluationLog } from "./evaluation.service";
import { askQuestionWithRag } from "./rag.service";

const toChatHistoryResponse = (
  history: IChatHistory,
): ChatHistoryResponse => ({
  id: history._id.toString(),
  userId: history.userId,
  question: history.question,
  originalQuestion: history.originalQuestion,
  rewrittenQuery: history.rewrittenQuery,
  answer: history.answer,
  sources: history.sources,
  documentId: history.documentId,
  subject: history.subject,
  mode: history.mode,
  evaluation: history.evaluation,
  createdAt: history.createdAt,
  updatedAt: history.updatedAt,
});

export const askQuestion = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<AskQuestionResponse> => {
  const mode = payload.mode || "basic";
  const result =
    mode === "corrective"
      ? await askQuestionWithCorrectiveRag(userId, payload)
      : await askQuestionWithRag(userId, payload);

  await ChatHistory.create({
    userId,
    question: payload.question,
    originalQuestion: result.originalQuestion,
    rewrittenQuery: result.rewrittenQuery,
    answer: result.answer,
    sources: result.sources,
    documentId: payload.documentId,
    subject: payload.subject,
    mode: result.mode,
    evaluation: result.evaluation,
  });

  await createEvaluationLog({
    userId,
    question: result.originalQuestion,
    rewrittenQuery: result.rewrittenQuery,
    retrievalMode: result.mode || "basic",
    retrievedChunksCount: result.evaluation?.retrievedChunksCount || 0,
    relevantChunksCount: result.evaluation?.relevantChunksCount || 0,
    averageRelevanceScore: result.evaluation?.averageRelevanceScore || 0,
    correctiveAttempted: result.evaluation?.correctiveAttempted || false,
    isGrounded: result.evaluation?.isGrounded ?? true,
    confidenceScore: result.evaluation?.confidenceScore || 0,
    responseTimeMs: result.evaluation?.responseTimeMs || 0,
    usedFallbackChunks: result.evaluation?.usedFallbackChunks,
    relevanceThreshold: result.evaluation?.relevanceThreshold,
    warning: result.evaluation?.warning,
    fallbackGenerated: result.evaluation?.fallbackGenerated,
    fallbackReason: result.evaluation?.fallbackReason,
    detectedIntent: result.evaluation?.detectedIntent,
    retrievedSections: result.evaluation?.retrievedSections,
  });

  return result;
};

export const getChatHistories = async (
  userId: string,
): Promise<ChatHistoryListResponse> => {
  const histories = await ChatHistory.find({ userId }).sort({ createdAt: -1 });

  return {
    histories: histories.map(toChatHistoryResponse),
    total: histories.length,
  };
};

export const getChatHistoryById = async (
  historyId: string,
  userId: string,
): Promise<ChatHistoryResponse> => {
  const history = await ChatHistory.findOne({
    _id: historyId,
    userId,
  });

  if (!history) {
    throw new AppError("Chat history not found", 404);
  }

  return toChatHistoryResponse(history);
};

export const deleteChatHistoryById = async (
  historyId: string,
  userId: string,
): Promise<void> => {
  const history = await ChatHistory.findOneAndDelete({
    _id: historyId,
    userId,
  });

  if (!history) {
    throw new AppError("Chat history not found", 404);
  }
};
