import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import { getUploadSessionStatus } from "./uploadSession.controller";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const uploadSessionIdSchema = z.object({
  params: z.object({
    uploadSessionId: objectIdSchema,
  }),
});

export const uploadSessionRouter = Router();
uploadSessionRouter.use(authMiddleware);
uploadSessionRouter.get(
  "/:uploadSessionId",
  validateRequest(uploadSessionIdSchema),
  getUploadSessionStatus,
);
