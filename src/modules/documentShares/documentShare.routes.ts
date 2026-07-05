import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createDocumentShareSchema,
  documentShareParamsSchema,
  revokeDocumentShareSchema,
  updateDocumentShareSchema,
} from "./documentShare.validation";
import {
  deleteDocumentShare,
  getDocumentShares,
  resendShareEmail,
  shareDocument,
  updateDocumentShare,
} from "./documentShare.controller";

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.post("/", validateRequest(createDocumentShareSchema), shareDocument);
router.get("/", validateRequest(documentShareParamsSchema), getDocumentShares);
router.post(
  "/:shareId/resend-email",
  validateRequest(revokeDocumentShareSchema),
  resendShareEmail,
);
router.patch(
  "/:shareId",
  validateRequest(updateDocumentShareSchema),
  updateDocumentShare,
);
router.delete(
  "/:shareId",
  validateRequest(revokeDocumentShareSchema),
  deleteDocumentShare,
);

export default router;
