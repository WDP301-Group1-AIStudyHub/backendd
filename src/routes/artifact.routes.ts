import { Router } from "express";
import {
  createArtifact,
  getArtifactDetail,
  listUserArtifacts,
  removeArtifact,
} from "../controllers/artifact.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  artifactByIdSchema,
  createArtifactSchema,
  listArtifactsSchema,
} from "../validations/artifact.validation";

const router = Router();

router.use(authMiddleware);

router.post("/", validateRequest(createArtifactSchema), createArtifact);

router.get("/", validateRequest(listArtifactsSchema), listUserArtifacts);

router.get("/:id", validateRequest(artifactByIdSchema), getArtifactDetail);

router.delete("/:id", validateRequest(artifactByIdSchema), removeArtifact);

export default router;
