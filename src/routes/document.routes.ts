import { Router } from "express";
import {
  listDocumentSubjects,
  reindexDocument,
  searchUserDocuments,
  uploadDocument,
} from "../controllers/document.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  documentReindexSchema,
  searchDocumentSchema,
  uploadDocumentSchema,
} from "../validations/document.validation";
import coreDocumentRoutes from "../modules/documents/document.routes";
import documentVersionRoutes from "../modules/documentVersions/documentVersion.routes";

const router = Router();

router.post(
  "/upload",
  authMiddleware,
  uploadMiddleware.single("file"),
  validateRequest(uploadDocumentSchema),
  uploadDocument,
);
router.get("/subjects", authMiddleware, listDocumentSubjects);
router.get(
  "/search",
  authMiddleware,
  validateRequest(searchDocumentSchema),
  searchUserDocuments,
);
router.post(
  "/:documentId/reindex",
  authMiddleware,
  validateRequest(documentReindexSchema),
  reindexDocument,
);
router.use("/:documentId/versions", documentVersionRoutes);
router.use("/", coreDocumentRoutes);

export default router;
