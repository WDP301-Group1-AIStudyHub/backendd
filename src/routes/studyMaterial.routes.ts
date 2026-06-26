import { Router } from "express";
import {
  generateMaterial,
  listMaterialsByDocument,
  getMaterialDetail,
  removeMaterial,
  listAllUserMaterials,
  explainMaterialCard,
} from "../controllers/studyMaterial.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  generateStudyMaterialSchema,
  getStudyMaterialByIdSchema,
  getStudyMaterialsByDocSchema,
} from "../validations/studyMaterial.validation";

const router = Router();

router.use(authMiddleware);

router.get(
  "/",
  listAllUserMaterials
);

router.post(
  "/explain",
  explainMaterialCard
);

router.post(
  "/generate",
  validateRequest(generateStudyMaterialSchema),
  generateMaterial
);

router.get(
  "/document/:documentId",
  validateRequest(getStudyMaterialsByDocSchema),
  listMaterialsByDocument
);

router.get(
  "/:id",
  validateRequest(getStudyMaterialByIdSchema),
  getMaterialDetail
);

router.delete(
  "/:id",
  validateRequest(getStudyMaterialByIdSchema),
  removeMaterial
);

export default router;
