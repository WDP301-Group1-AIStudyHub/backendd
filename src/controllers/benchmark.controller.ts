import { Request, Response } from "express";
import {
  BenchmarkQuestionRequest,
} from "../types/api.types";
import {
  createBenchmarkQuestion,
  deleteBenchmarkQuestion,
  getBenchmarkQuestionById,
  getBenchmarkQuestions,
  getBenchmarkSummary,
  runBenchmarkQuestion,
  updateBenchmarkQuestion,
} from "../services/benchmark.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const createQuestion = asyncHandler(async (
  req: Request<unknown, unknown, BenchmarkQuestionRequest>,
  res: Response,
): Promise<void> => {
  const data = await createBenchmarkQuestion(req.authUser!.id, req.body);

  sendResponse(res, 201, {
    success: true,
    message: "Benchmark question created successfully",
    data,
  });
});

export const listQuestions = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getBenchmarkQuestions(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Benchmark questions fetched successfully",
    data,
  });
});

export const getQuestion = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getBenchmarkQuestionById(req.authUser!.id, req.params.id);

  sendResponse(res, 200, {
    success: true,
    message: "Benchmark question fetched successfully",
    data,
  });
});

export const editQuestion = asyncHandler(async (
  req: Request<{ id: string }, unknown, Partial<BenchmarkQuestionRequest>>,
  res: Response,
): Promise<void> => {
  const data = await updateBenchmarkQuestion(
    req.authUser!.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Benchmark question updated successfully",
    data,
  });
});

export const removeQuestion = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  await deleteBenchmarkQuestion(req.authUser!.id, req.params.id);

  sendResponse(res, 200, {
    success: true,
    message: "Benchmark question deleted successfully",
  });
});

export const runQuestionBenchmark = asyncHandler(async (
  req: Request<{ questionId: string }>,
  res: Response,
): Promise<void> => {
  const data = await runBenchmarkQuestion(req.authUser!.id, req.params.questionId);

  sendResponse(res, 201, {
    success: true,
    message: "Benchmark run completed successfully",
    data,
  });
});

export const benchmarkSummary = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getBenchmarkSummary(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Benchmark summary fetched successfully",
    data,
  });
});
