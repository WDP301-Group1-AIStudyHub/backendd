import { Request, Response } from "express";
import {
  deleteArtifact,
  getArtifactById,
  initiateArtifactGeneration,
  listArtifacts,
} from "../services/artifact.service";
import {
  listArtifactShares,
  listArtifactsSharedWithMe,
  revokeArtifactShare,
  shareArtifact,
} from "../services/artifactShare.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const createArtifact = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.authUser!.id;
    const isAdmin = req.authUser?.role === "admin";

    const data = await initiateArtifactGeneration(userId, req.body, { isAdmin });

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

    const { artifact, isOwner } = await getArtifactById(userId, id);

    sendResponse(res, 200, {
      success: true,
      message: "Artifact fetched successfully",
      // Spread rather than nest: existing flashcard/quiz clients read the
      // artifact fields straight off `data`, and isOwner is additive.
      data: { ...artifact.toJSON(), isOwner },
    });
  }
);

export const shareArtifactWithUser = asyncHandler(
  async (
    req: Request<{ id: string }, unknown, { email: string; permission: "VIEW" }>,
    res: Response
  ): Promise<void> => {
    const data = await shareArtifact(req.params.id, req.authUser!.id, req.body);

    sendResponse(res, 201, {
      success: true,
      message: "Summary shared successfully",
      data,
    });
  }
);

export const getArtifactShares = asyncHandler(
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const data = await listArtifactShares(req.params.id, req.authUser!.id);

    sendResponse(res, 200, {
      success: true,
      message: "Artifact shares fetched successfully",
      data,
    });
  }
);

export const removeArtifactShare = asyncHandler(
  async (
    req: Request<{ id: string; shareId: string }>,
    res: Response
  ): Promise<void> => {
    await revokeArtifactShare(
      req.params.id,
      req.params.shareId,
      req.authUser!.id
    );

    sendResponse(res, 200, {
      success: true,
      message: "Artifact share revoked successfully",
    });
  }
);

export const getArtifactsSharedWithMe = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data = await listArtifactsSharedWithMe(req.authUser!.id);

    sendResponse(res, 200, {
      success: true,
      message: "Shared summaries fetched successfully",
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
