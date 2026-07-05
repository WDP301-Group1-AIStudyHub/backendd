import { Router, Request } from "express";
import { AppError } from "../middlewares/error.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { sendResponse } from "../utils/apiResponse";
import { purgeExpiredTrashDocuments } from "../modules/documents/document.service";

const router = Router();

const getBearerToken = (req: Request): string | undefined => {
  const authorization = req.header("authorization");

  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1];
};

const assertJobSecret = (req: Request): void => {
  const expectedSecret = process.env.JOB_SECRET?.trim();

  if (!expectedSecret) {
    throw new AppError("JOB_SECRET is not configured", 500);
  }

  const providedSecret = req.header("x-job-secret") || getBearerToken(req);

  if (providedSecret !== expectedSecret) {
    throw new AppError("Forbidden", 403);
  }
};

router.post(
  "/purge-trash",
  asyncHandler(async (req, res) => {
    assertJobSecret(req);

    const data = await purgeExpiredTrashDocuments();

    sendResponse(res, 200, {
      success: true,
      message: "Expired trash documents purged successfully",
      data,
    });
  }),
);

export default router;
