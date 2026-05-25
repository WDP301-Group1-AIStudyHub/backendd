import { Router } from "express";
import {
  editDocument,
  getDocument,
  listDocuments,
  reindexDocument,
  removeDocument,
  searchUserDocuments,
  uploadDocument,
} from "../controllers/document.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  documentIdSchema,
  documentReindexSchema,
  searchDocumentSchema,
  updateDocumentSchema,
  uploadDocumentSchema,
} from "../validations/document.validation";

const router = Router();

router.use(authMiddleware);

router.post(
  "/upload",
  uploadMiddleware.single("file"),
  validateRequest(uploadDocumentSchema),
  uploadDocument,
);
router.get("/", listDocuments);
router.get("/search", validateRequest(searchDocumentSchema), searchUserDocuments);
router.post(
  "/:documentId/reindex",
  validateRequest(documentReindexSchema),
  reindexDocument,
);
router.get("/:id", validateRequest(documentIdSchema), getDocument);
router.put("/:id", validateRequest(updateDocumentSchema), editDocument);
router.delete("/:id", validateRequest(documentIdSchema), removeDocument);

export default router;
