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

export const askStream = asyncHandler(async (
  req: Request<unknown, unknown, AskQuestionRequest>,
  res: Response,
): Promise<void> => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  try {
    await askQuestionWithAgent(req.authUser!.id, req.body, {
      onEvent: (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      signal: abortController.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError" || err instanceof DOMException && err.name === "AbortError") {
      // Stream aborted by client - nothing to write since connection is closed
      return;
    }
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message || "Unknown error" })}\n\n`);
  } finally {
    res.end();
  }
});

