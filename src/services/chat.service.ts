import { ChatHistory, IChatHistory } from "../models/chatHistory.model";
import { ChatThread, IChatThread } from "../models/chatThread.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatHistoryListResponse,
  ChatHistoryResponse,
  ChatThreadDetailResponse,
  ChatThreadListResponse,
  ChatThreadResponse,
} from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import { createEvaluationLog } from "./evaluation.service";
import { askQuestionWithDrRag } from "./drRag.service";
import { answerDocumentStructureQuestion } from "./documentStructureAnswer.service";
import { resolveChatScope } from "./chatScope.service";

const toChatHistoryResponse = (
  history: IChatHistory,
): ChatHistoryResponse => ({
  id: history._id.toString(),
  userId: history.userId,
  threadId: history.threadId,
  question: history.question,
  originalQuestion: history.originalQuestion,
  rewrittenQuery: history.rewrittenQuery,
  answer: history.answer,
  sources: history.sources,
  documentId: history.documentId,
  documentIds: history.documentIds,
  subjectId: history.subjectId,
  scope: history.scope,
  mode: history.mode,
  evaluation: history.evaluation,
  createdAt: history.createdAt,
  updatedAt: history.updatedAt,
});

const toChatThreadResponse = (thread: IChatThread): ChatThreadResponse => ({
  id: thread._id.toString(),
  ownerId: thread.ownerId,
  title: thread.title,
  status: thread.status,
  lastMessageAt: thread.lastMessageAt,
  messageCount: thread.messageCount,
  scope: thread.scope,
  subjectId: thread.subjectId,
  documentId: thread.documentId,
  documentIds: thread.documentIds,
  mode: thread.mode,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
});

const buildThreadTitle = (question: string): string => {
  const normalized = question.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

const getOrCreateThread = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<IChatThread> => {
  if (payload.threadId) {
    const thread = await ChatThread.findOne({
      _id: payload.threadId,
      ownerId: userId,
      status: "ACTIVE",
    });

    if (!thread) {
      throw new AppError("Chat thread not found", 404);
    }

    return thread;
  }

  return ChatThread.create({
    ownerId: userId,
    title: buildThreadTitle(payload.question),
    lastMessageAt: new Date(),
    messageCount: 0,
    status: "ACTIVE",
    scope: payload.scope,
    subjectId: payload.subjectId,
    documentId: payload.documentId,
    documentIds: payload.documentIds,
    mode: "dr-rag",
  });
};

export const askQuestion = async (
  userId: string,
  payload: AskQuestionRequest,
  options: { persistHistory?: boolean } = {},
): Promise<AskQuestionResponse> => {
  const persistHistory = options.persistHistory ?? true;
  const chatScope = await resolveChatScope(userId, payload);

  const structuralResult = await answerDocumentStructureQuestion(userId, payload);
  const result =
    structuralResult ||
    (await askQuestionWithDrRag(userId, payload));
  const evaluation = result.evaluation;

  let threadId: string | undefined;

  if (persistHistory) {
    const thread = await getOrCreateThread(userId, payload);
    threadId = thread._id.toString();

    await ChatHistory.create({
      userId,
      threadId: thread._id,
      question: payload.question,
      originalQuestion: result.originalQuestion,
      rewrittenQuery: result.rewrittenQuery,
      answer: result.answer,
      sources: result.sources,
      documentId: chatScope.documentId,
      documentIds: chatScope.documentIds,
      subjectId: chatScope.subjectId,
      scope: payload.scope || chatScope.scope,
      mode: result.mode,
      evaluation,
    });

    await ChatThread.findOneAndUpdate(
      { _id: thread._id, ownerId: userId },
      {
        $inc: { messageCount: 1 },
        $set: {
          lastMessageAt: new Date(),
          scope: payload.scope || chatScope.scope,
          subjectId: chatScope.subjectId,
          documentId: chatScope.documentId,
          documentIds: chatScope.documentIds,
          mode: result.mode,
        },
      },
      { runValidators: true },
    );

    await createEvaluationLog({
      userId,
      question: result.originalQuestion,
      rewrittenQuery: result.rewrittenQuery,
      retrievalMode: result.mode,
      retrievedChunksCount: evaluation.retrievedChunksCount,
      relevantChunksCount: evaluation.relevantChunksCount,
      averageRelevanceScore: evaluation.averageRelevanceScore,
      isGrounded: evaluation.isGrounded,
      confidenceScore: evaluation.confidenceScore,
      responseTimeMs: evaluation.responseTimeMs,
      stageOneChunksCount: evaluation.stageOneChunksCount,
      stageTwoChunksCount: evaluation.stageTwoChunksCount,
      selectedStaticChunksCount: evaluation.selectedStaticChunksCount,
      selectedDynamicChunksCount: evaluation.selectedDynamicChunksCount,
      dynamicRetrievalAttempted: evaluation.dynamicRetrievalAttempted,
      selectionStrategy: evaluation.selectionStrategy,
      retrievalQueries: evaluation.retrievalQueries,
      usedFallbackChunks: evaluation.usedFallbackChunks,
      relevanceThreshold: evaluation.relevanceThreshold,
      warning: evaluation.warning,
      fallbackGenerated: evaluation.fallbackGenerated,
      fallbackReason: evaluation.fallbackReason,
      detectedIntent: evaluation.detectedIntent,
      retrievedSections: evaluation.retrievedSections,
      answerProfile: evaluation.answerProfile,
      usedSectionExpansion: evaluation.usedSectionExpansion,
      selectedSectionTitle: evaluation.selectedSectionTitle,
      contextChunksUsed: evaluation.contextChunksUsed,
    });
  }

  return {
    ...result,
    threadId,
  };
};

export const getChatThreads = async (
  userId: string,
): Promise<ChatThreadListResponse> => {
  const threads = await ChatThread.find({
    ownerId: userId,
    status: "ACTIVE",
  }).sort({ lastMessageAt: -1, createdAt: -1 });

  return {
    threads: threads.map(toChatThreadResponse),
    total: threads.length,
  };
};

export const getChatThreadById = async (
  threadId: string,
  userId: string,
): Promise<ChatThreadDetailResponse> => {
  const thread = await ChatThread.findOne({
    _id: threadId,
    ownerId: userId,
    status: "ACTIVE",
  });

  if (!thread) {
    throw new AppError("Chat thread not found", 404);
  }

  const messages = await ChatHistory.find({
    userId,
    threadId: thread._id,
  }).sort({ createdAt: 1 });

  return {
    thread: toChatThreadResponse(thread),
    messages: messages.map(toChatHistoryResponse),
  };
};

export const updateChatThreadById = async (
  threadId: string,
  userId: string,
  payload: { title?: string; status?: "ACTIVE" | "ARCHIVED" },
): Promise<ChatThreadResponse> => {
  const thread = await ChatThread.findOneAndUpdate(
    { _id: threadId, ownerId: userId },
    payload,
    { new: true, runValidators: true },
  );

  if (!thread) {
    throw new AppError("Chat thread not found", 404);
  }

  return toChatThreadResponse(thread);
};

export const archiveChatThreadById = async (
  threadId: string,
  userId: string,
): Promise<void> => {
  const thread = await ChatThread.findOneAndUpdate(
    { _id: threadId, ownerId: userId, status: "ACTIVE" },
    { status: "ARCHIVED" },
    { new: true, runValidators: true },
  );

  if (!thread) {
    throw new AppError("Chat thread not found", 404);
  }
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
