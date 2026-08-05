import { Router } from "express";
import {
  createArtifact,
  getArtifactDetail,
  getArtifactShares,
  getArtifactsSharedWithMe,
  listUserArtifacts,
  removeArtifact,
  removeArtifactShare,
  shareArtifactWithUser,
} from "../controllers/artifact.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  artifactByIdSchema,
  artifactShareParamsSchema,
  createArtifactSchema,
  createArtifactShareSchema,
  listArtifactsSchema,
} from "../validations/artifact.validation";

const router = Router();

router.use(authMiddleware);

router.post("/", validateRequest(createArtifactSchema), createArtifact);

router.get("/", validateRequest(listArtifactsSchema), listUserArtifacts);

// Registered before "/:id" so the literal path is not swallowed as an id.
router.get("/shared-with-me", getArtifactsSharedWithMe);

router.post(
  "/:id/shares",
  validateRequest(createArtifactShareSchema),
  shareArtifactWithUser
);

router.get("/:id/shares", validateRequest(artifactByIdSchema), getArtifactShares);

router.delete(
  "/:id/shares/:shareId",
  validateRequest(artifactShareParamsSchema),
  removeArtifactShare
);

router.get("/:id", validateRequest(artifactByIdSchema), getArtifactDetail);

router.delete("/:id", validateRequest(artifactByIdSchema), removeArtifact);

export default router;
