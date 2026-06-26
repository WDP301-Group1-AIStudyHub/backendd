import { Request, Response } from "express";
import { AskQuestionRequest } from "../types/api.types";
import {
  archiveChatThreadById,
  askQuestion,
  deleteChatHistoryById,
  getChatHistories,
  getChatHistoryById,
  getChatThreadById,
  getChatThreads,
  updateChatThreadById,
} from "../services/chat.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const ask = asyncHandler(async (
  req: Request<unknown, unknown, AskQuestionRequest>,
  res: Response,
): Promise<void> => {
  const data = await askQuestion(req.authUser!.id, req.body);

  sendResponse(res, 200, {
    success: true,
    message: "Question answered successfully",
    data,
  });
});

export const listChatHistory = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getChatHistories(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat history fetched successfully",
    data,
  });
});

export const listChatThreads = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getChatThreads(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat threads fetched successfully",
    data,
  });
});

export const getChatThread = asyncHandler(async (
  req: Request<{ threadId: string }>,
  res: Response,
): Promise<void> => {
  const data = await getChatThreadById(req.params.threadId, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat thread fetched successfully",
    data,
  });
});

export const updateChatThread = asyncHandler(async (
  req: Request<{ threadId: string }, unknown, { title?: string; status?: "ACTIVE" | "ARCHIVED" }>,
  res: Response,
): Promise<void> => {
  const data = await updateChatThreadById(
    req.params.threadId,
    req.authUser!.id,
    req.body,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Chat thread updated successfully",
    data,
  });
});

export const removeChatThread = asyncHandler(async (
  req: Request<{ threadId: string }>,
  res: Response,
): Promise<void> => {
  await archiveChatThreadById(req.params.threadId, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat thread deleted successfully",
  });
});

export const getChatHistory = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getChatHistoryById(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat history fetched successfully",
    data,
  });
});

export const removeChatHistory = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  await deleteChatHistoryById(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Chat history deleted successfully",
  });
});
