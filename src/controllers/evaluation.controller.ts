import { Request, Response } from "express";
import {
  getEvaluationLogs,
  getEvaluationSummary,
} from "../services/evaluation.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const listEvaluationLogs = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getEvaluationLogs(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Evaluation logs fetched successfully",
    data,
  });
});

export const evaluationSummary = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getEvaluationSummary(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Evaluation summary fetched successfully",
    data,
  });
});
