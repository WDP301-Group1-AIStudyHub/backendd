import { Request, Response } from "express";
import { AskQuestionRequest } from "../types/api.types";
import { askQuestionWithAgent } from "../services/agenticRag.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const ask = asyncHandler(async (
  req: Request<unknown, unknown, AskQuestionRequest>,
  res: Response,
): Promise<void> => {
  const data = await askQuestionWithAgent(req.authUser!.id, req.body);

  sendResponse(res, 200, {
    success: true,
    message: "Question answered successfully",
    data,
  });
});
