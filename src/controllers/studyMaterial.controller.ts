import { Request, Response } from "express";
import {
  initiateMaterialGeneration,
  getStudyMaterialsByDoc,
  getStudyMaterialById,
  deleteStudyMaterial,
  getAllStudyMaterials,
  generateCardExplanation,
} from "../services/studyMaterial.service";
import { AppError } from "../middlewares/error.middleware";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const generateMaterial = asyncHandler(async (
  req: Request,
  res: Response
): Promise<void> => {
  const { documentId, type, count, difficulty, topicFocus } = req.body;
  const userId = req.authUser!.id;

  const data = await initiateMaterialGeneration(userId, documentId, type, count, difficulty, topicFocus);

  sendResponse(res, 202, {
    success: true,
    message: "Study material generation started in background",
    data,
  });
});

export const listMaterialsByDocument = asyncHandler(async (
  req: Request<{ documentId: string }>,
  res: Response
): Promise<void> => {
  const userId = req.authUser!.id;
  const { documentId } = req.params;

  const data = await getStudyMaterialsByDoc(userId, documentId);

  sendResponse(res, 200, {
    success: true,
    message: "Study materials fetched successfully",
    data,
  });
});

export const getMaterialDetail = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  const userId = req.authUser!.id;
  const { id } = req.params;

  const data = await getStudyMaterialById(userId, id);

  sendResponse(res, 200, {
    success: true,
    message: "Study material fetched successfully",
    data,
  });
});

export const removeMaterial = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  const userId = req.authUser!.id;
  const { id } = req.params;

  await deleteStudyMaterial(userId, id);

  sendResponse(res, 200, {
    success: true,
    message: "Study material deleted successfully",
  });
});

export const listAllUserMaterials = asyncHandler(async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.authUser!.id;

  const data = await getAllStudyMaterials(userId);

  sendResponse(res, 200, {
    success: true,
    message: "All study materials fetched successfully",
    data,
  });
});

export const explainMaterialCard = asyncHandler(async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.authUser!.id;
  const { materialId, cardIndex } = req.body;

  if (!materialId || cardIndex === undefined) {
    throw new AppError("materialId and cardIndex are required", 400);
  }

  const explanation = await generateCardExplanation(userId, materialId, Number(cardIndex));

  sendResponse(res, 200, {
    success: true,
    message: "Explanation generated successfully",
    data: { explanation },
  });
});
