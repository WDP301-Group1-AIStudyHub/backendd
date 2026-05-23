import { ChatHistory, IChatHistory } from "../models/chatHistory.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatHistoryListResponse,
  ChatHistoryResponse,
} from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import { askQuestionWithRag } from "./rag.service";

const toChatHistoryResponse = (
  history: IChatHistory,
): ChatHistoryResponse => ({
  id: history._id.toString(),
  userId: history.userId,
  question: history.question,
  answer: history.answer,
  sources: history.sources,
  documentId: history.documentId,
  subject: history.subject,
  createdAt: history.createdAt,
  updatedAt: history.updatedAt,
});

export const askQuestion = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<AskQuestionResponse> => {
  const result = await askQuestionWithRag(userId, payload);

  await ChatHistory.create({
    userId,
    question: payload.question,
    answer: result.answer,
    sources: result.sources,
    documentId: payload.documentId,
    subject: payload.subject,
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
