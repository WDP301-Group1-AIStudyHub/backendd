import { Request, Response } from "express";
import { AskQuestionRequest } from "../types/api.types";
import {
  askQuestion,
  deleteChatHistoryById,
  getChatHistories,
  getChatHistoryById,
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
