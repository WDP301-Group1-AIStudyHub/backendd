import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  createOrUpdateDocumentShare,
  listDocumentShares,
  revokeDocumentShare,
  updateDocumentSharePermission,
} from "./documentShare.service";
import { DocumentSharePermission } from "./documentShare.model";

export const shareDocument = asyncHandler(async (
  req: Request<{ id: string }, unknown, { email: string; permission: DocumentSharePermission }>,
  res: Response,
): Promise<void> => {
  const data = await createOrUpdateDocumentShare(
    req.params.id,
    req.authUser!.id,
    req.body,
  );

  sendResponse(res, 200, {
    success: true,
    message:
      data.status === "PENDING"
        ? "Invitation sent. Access will activate after registration."
        : "Document shared successfully",
    data,
  });
});

export const getDocumentShares = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await listDocumentShares(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Document shares fetched successfully",
    data,
  });
});

export const updateDocumentShare = asyncHandler(async (
  req: Request<{ id: string; shareId: string }, unknown, { permission: DocumentSharePermission }>,
  res: Response,
): Promise<void> => {
  const data = await updateDocumentSharePermission(
    req.params.id,
    req.params.shareId,
    req.authUser!.id,
    req.body.permission,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document share updated successfully",
    data,
  });
});

export const deleteDocumentShare = asyncHandler(async (
  req: Request<{ id: string; shareId: string }>,
  res: Response,
): Promise<void> => {
  await revokeDocumentShare(req.params.id, req.params.shareId, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Document share revoked successfully",
  });
});
