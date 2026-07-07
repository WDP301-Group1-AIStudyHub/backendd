import { Request, Response } from "express";
import {
  deleteArtifact,
  getArtifactById,
  initiateArtifactGeneration,
  listArtifacts,
} from "../services/artifact.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const createArtifact = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.authUser!.id;

    const data = await initiateArtifactGeneration(userId, req.body);

    sendResponse(res, 202, {
      success: true,
      message: "Artifact generation started in background",
      data,
    });
  }
);

export const listUserArtifacts = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.authUser!.id;
    const threadId =
      typeof req.query.threadId === "string" ? req.query.threadId : undefined;

    const data = await listArtifacts(userId, { threadId });

    sendResponse(res, 200, {
      success: true,
      message: "Artifacts fetched successfully",
      data,
    });
  }
);

export const getArtifactDetail = asyncHandler(
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const userId = req.authUser!.id;
    const { id } = req.params;

    const data = await getArtifactById(userId, id);

    sendResponse(res, 200, {
      success: true,
      message: "Artifact fetched successfully",
      data,
    });
  }
);

export const removeArtifact = asyncHandler(
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const userId = req.authUser!.id;
    const { id } = req.params;

    await deleteArtifact(userId, id);

    sendResponse(res, 200, {
      success: true,
      message: "Artifact deleted successfully",
    });
  }
);
