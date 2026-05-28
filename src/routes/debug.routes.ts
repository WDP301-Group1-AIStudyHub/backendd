import { Router } from "express";
import { getDebugChunks } from "../controllers/debug.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import { documentReindexSchema } from "../validations/document.validation";

const router = Router();

router.use(authMiddleware);

router.get(
  "/documents/:documentId/chunks",
  validateRequest(documentReindexSchema),
  getDebugChunks,
);

export default router;
