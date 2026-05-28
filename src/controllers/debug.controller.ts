import { Request, Response } from "express";
import { getDebugDocumentChunks } from "../services/document.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const getDebugChunks = asyncHandler(async (
  req: Request<{ documentId: string }>,
  res: Response,
): Promise<void> => {
  const data = await getDebugDocumentChunks(
    req.params.documentId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document chunks generated successfully",
    data,
  });
});
