import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  createOrUpdateDocumentShare,
  listDocumentShares,
  resendDocumentShareEmail,
  revokeDocumentShare,
  updateDocumentSharePermission,
} from "./documentShare.service";
import { DocumentSharePermission } from "./documentShare.model";

const getShareResponseMessage = (
  status: "ACTIVE" | "PENDING",
  notificationStatus?: "ACCEPTED" | "FAILED" | "SKIPPED",
): string => {
  if (notificationStatus === "FAILED") {
    return status === "PENDING"
      ? "Invitation created, but the notification email could not be sent"
      : "Document shared, but the notification email could not be sent";
  }

  if (notificationStatus === "SKIPPED") {
    return status === "PENDING"
      ? "Invitation already exists; use resend email to notify the recipient"
      : "Document access already exists; use resend email to notify the recipient";
  }

  return status === "PENDING"
    ? "Invitation sent. Access will activate after registration."
    : "Document shared successfully";
};

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
    message: getShareResponseMessage(data.status, data.notificationStatus),
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
    message: getShareResponseMessage(data.status, data.notificationStatus),
    data,
  });
});

export const resendShareEmail = asyncHandler(async (
  req: Request<{ id: string; shareId: string }>,
  res: Response,
): Promise<void> => {
  const data = await resendDocumentShareEmail(
    req.params.id,
    req.params.shareId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message:
      data.notificationStatus === "ACCEPTED"
        ? "Share notification email accepted for delivery"
        : "Share notification email could not be sent",
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
