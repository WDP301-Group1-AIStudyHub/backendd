import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import { getUploadSessionById } from "./uploadSession.service";

export const getUploadSessionStatus = asyncHandler(async (
  req: Request<{ uploadSessionId: string }>,
  res: Response,
): Promise<void> => {
  const data = await getUploadSessionById(
    req.params.uploadSessionId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Upload session status fetched successfully",
    data,
  });
});
