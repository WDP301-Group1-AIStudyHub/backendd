import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { uploadMiddleware } from "../../middlewares/upload.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  activateVersion,
  getVersion,
  listVersions,
  reindexVersion,
  removeVersion,
  uploadVersion,
} from "./documentVersion.controller";
import {
  documentVersionIdSchema,
  getDocumentVersionDetailSchema,
  listDocumentVersionsSchema,
  uploadDocumentVersionSchema,
} from "./documentVersion.validation";

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.post(
  "/",
  uploadMiddleware.single("file"),
  validateRequest(uploadDocumentVersionSchema),
  uploadVersion,
);
router.get("/", validateRequest(listDocumentVersionsSchema), listVersions);
router.get(
  "/:versionId",
  validateRequest(getDocumentVersionDetailSchema),
  getVersion,
);
router.patch(
  "/:versionId/activate",
  validateRequest(documentVersionIdSchema),
  activateVersion,
);
router.post(
  "/:versionId/reindex",
  validateRequest(documentVersionIdSchema),
  reindexVersion,
);
router.delete(
  "/:versionId",
  validateRequest(documentVersionIdSchema),
  removeVersion,
);

export default router;
