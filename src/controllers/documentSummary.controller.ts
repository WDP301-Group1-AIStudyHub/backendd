import { Request, Response } from "express";
import { createDocumentSummary } from "../services/documentSummary.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const createSummary = asyncHandler(
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const isAdmin = String(req.authUser?.role).toLowerCase() === "admin";

    const { artifact, cached } = await createDocumentSummary(
      req.authUser!.id,
      req.params.id,
      { isAdmin }
    );

    // 200 for a cache hit, 202 for work that was actually started — the status
    // code alone tells the client whether a prompt was spent.
    sendResponse(res, cached ? 200 : 202, {
      success: true,
      message: cached
        ? "This document already has a summary"
        : "Summary generation started in background",
      data: { ...artifact.toJSON(), cached },
    });
  }
);
