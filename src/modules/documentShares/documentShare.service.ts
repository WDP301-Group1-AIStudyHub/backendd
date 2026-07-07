import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { StudyDocument, IDocument } from "../documents/document.model";
import { User } from "../../models/user.model";
import {
  DocumentShare,
  DocumentSharePermission,
  IDocumentShare,
} from "./documentShare.model";
import {
  EmailDeliveryResult,
  EmailDeliveryStatus,
  sendDocumentShareEmail,
} from "../../services/email.service";
import { DocumentShareInvitation } from "./documentShareInvitation.model";
import {
  createOrUpdateInvitation,
  resendDocumentShareInvitation,
  toPendingShareResponse,
} from "./documentShareInvitation.service";
import {
  buildMobileDocumentUrl,
  buildWebDocumentUrl,
} from "../../services/publicAppUrl.service";

export type DocumentAccessRole = "OWNER" | "EDITOR" | "VIEWER";
export type RequiredDocumentAccess = "VIEW" | "EDIT" | "OWNER";

export interface DocumentShareResponse {
  id: string;
  documentId: string;
  sharedWithUser: {
    id: string;
    fullName: string;
    email: string;
    avatar?: string;
  };
  permission: DocumentSharePermission;
  sharedBy: string;
  status: "ACTIVE" | "PENDING";
  notificationStatus?: EmailDeliveryStatus;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

type PopulatedUser = {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  avatar?: string;
};

const toUserSummary = (user: unknown): DocumentShareResponse["sharedWithUser"] => {
  const populated = user as PopulatedUser;

  return {
    id: populated._id.toString(),
    fullName: populated.fullName,
    email: populated.email,
    avatar: populated.avatar,
  };
};

export const toDocumentShareResponse = (
  share: IDocumentShare,
  notificationStatus?: EmailDeliveryStatus,
): DocumentShareResponse => ({
  id: share._id.toString(),
  documentId: share.documentId.toString(),
  sharedWithUser: toUserSummary(share.sharedWithUserId),
  permission: share.permission,
  sharedBy: share.sharedBy.toString(),
  status: "ACTIVE",
  createdAt: share.createdAt,
  updatedAt: share.updatedAt,
  ...(notificationStatus ? { notificationStatus } : {}),
});

export const permissionToAccessRole = (
  permission: DocumentSharePermission,
): DocumentAccessRole => (permission === "EDIT" ? "EDITOR" : "VIEWER");

export const canRoleRead = (role: DocumentAccessRole): boolean =>
  role === "OWNER" || role === "EDITOR" || role === "VIEWER";

export const canRoleEdit = (role: DocumentAccessRole): boolean =>
  role === "OWNER" || role === "EDITOR";

export const canRoleManage = (role: DocumentAccessRole): boolean =>
  role === "OWNER";

export const assertRoleHasAccess = (
  role: DocumentAccessRole,
  required: RequiredDocumentAccess,
): void => {
  if (required === "OWNER" && !canRoleManage(role)) {
    throw new AppError("Only the document owner can perform this action", 403);
  }

  if (required === "EDIT" && !canRoleEdit(role)) {
    throw new AppError("You do not have permission to edit this document", 403);
  }

  if (required === "VIEW" && !canRoleRead(role)) {
    throw new AppError("You do not have permission to view this document", 403);
  }
};

export const getDocumentAccessRole = async (
  document: Pick<IDocument, "ownerId" | "_id">,
  userId: string,
  role = "user",
): Promise<DocumentAccessRole | null> => {
  if (role === "admin" || document.ownerId.toString() === userId) {
    return "OWNER";
  }

  const share = await DocumentShare.findOne({
    documentId: document._id,
    sharedWithUserId: userId,
  }).select("permission");

  return share ? permissionToAccessRole(share.permission) : null;
};

export const getAccessibleDocumentOrThrow = async (
  documentId: string,
  userId: string,
  required: RequiredDocumentAccess = "VIEW",
  role = "user",
): Promise<{ document: IDocument; accessRole: DocumentAccessRole }> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const accessRole = await getDocumentAccessRole(document, userId, role);

  if (!accessRole) {
    throw new AppError("Document not found", 404);
  }

  assertRoleHasAccess(accessRole, required);

  return { document, accessRole };
};

const sendShareEmailSafely = async ({
  document,
  isPermissionUpdate,
  permission,
  recipient,
  sender,
}: {
  document: IDocument;
  isPermissionUpdate: boolean;
  permission: DocumentSharePermission;
  recipient: PopulatedUser;
  sender: PopulatedUser;
}): Promise<EmailDeliveryResult> => {
  try {
    return await sendDocumentShareEmail({
      to: recipient.email,
      recipientName: recipient.fullName,
      senderName: sender.fullName,
      documentTitle: document.title,
      permission,
      documentUrl: buildWebDocumentUrl(document._id.toString()),
      mobileUrl: buildMobileDocumentUrl(document._id.toString()),
      isPermissionUpdate,
    });
  } catch (error) {
    console.warn("[document-share] Failed to send share email", {
      documentId: document._id.toString(),
      recipient: recipient.email,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "FAILED", errorCode: "EMAIL_DELIVERY_FAILED" };
  }
};

export const createOrUpdateDocumentShare = async (
  documentId: string,
  ownerId: string,
  payload: { email: string; permission: DocumentSharePermission },
): Promise<DocumentShareResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const [recipient, sender] = await Promise.all([
    User.findOne({ email: payload.email.toLowerCase() }).select(
      "_id fullName email avatar",
    ),
    User.findById(ownerId).select("_id fullName email avatar"),
  ]);

  if (!sender) {
    throw new AppError("Sharing user not found", 404);
  }

  if (!recipient) {
    const { invitation, notificationStatus } = await createOrUpdateInvitation({
      document,
      email: payload.email,
      permission: payload.permission,
      sender,
      sharedBy: ownerId,
    });

    return toPendingShareResponse(invitation, notificationStatus);
  }

  if (recipient._id.toString() === ownerId) {
    throw new AppError("You cannot share a document with yourself", 400);
  }

  const existingShare = await DocumentShare.findOne({
    documentId,
    sharedWithUserId: recipient._id,
  });
  const isPermissionUpdate =
    Boolean(existingShare) && existingShare?.permission !== payload.permission;

  const share =
    existingShare ||
    new DocumentShare({
      documentId,
      sharedWithUserId: recipient._id,
      sharedBy: ownerId,
    });

  share.permission = payload.permission;
  share.sharedBy = new Types.ObjectId(ownerId);
  await share.save();
  await share.populate("sharedWithUserId", "_id fullName email avatar");
  await DocumentShareInvitation.deleteOne({
    documentId,
    email: recipient.email.toLowerCase(),
  });

  let notificationStatus: EmailDeliveryStatus = "SKIPPED";
  if (!existingShare || isPermissionUpdate) {
    const delivery = await sendShareEmailSafely({
      document,
      isPermissionUpdate,
      permission: payload.permission,
      recipient,
      sender,
    });
    notificationStatus = delivery.status;
  }

  return toDocumentShareResponse(share, notificationStatus);
};

export const listDocumentShares = async (
  documentId: string,
  ownerId: string,
): Promise<DocumentShareResponse[]> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const [shares, invitations] = await Promise.all([
    DocumentShare.find({ documentId })
      .populate("sharedWithUserId", "_id fullName email avatar")
      .sort({ createdAt: -1 }),
    DocumentShareInvitation.find({
      documentId,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }),
  ]);

  return [
    ...shares.map((share) => toDocumentShareResponse(share)),
    ...invitations.map((invitation) => toPendingShareResponse(invitation)),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};

export const updateDocumentSharePermission = async (
  documentId: string,
  shareId: string,
  ownerId: string,
  permission: DocumentSharePermission,
): Promise<DocumentShareResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const share = await DocumentShare.findOne({ _id: shareId, documentId });

  if (!share) {
    const invitation = await DocumentShareInvitation.findOne({
      _id: shareId,
      documentId,
      expiresAt: { $gt: new Date() },
    });

    if (!invitation) {
      throw new AppError("Share not found", 404);
    }

    const sender = await User.findById(ownerId).select(
      "_id fullName email avatar",
    );

    if (!sender) {
      throw new AppError("Sharing user not found", 404);
    }

    const { invitation: updatedInvitation, notificationStatus } =
      await createOrUpdateInvitation({
      document,
      email: invitation.email,
      permission,
      sender,
      sharedBy: ownerId,
    });
    return toPendingShareResponse(updatedInvitation, notificationStatus);
  }

  const [recipient, sender] = await Promise.all([
    User.findById(share.sharedWithUserId).select("_id fullName email avatar"),
    User.findById(ownerId).select("_id fullName email avatar"),
  ]);

  if (!recipient || !sender) {
    throw new AppError("Share user not found", 404);
  }

  const changed = share.permission !== permission;
  share.permission = permission;
  share.sharedBy = new Types.ObjectId(ownerId);
  await share.save();
  await share.populate("sharedWithUserId", "_id fullName email avatar");

  let notificationStatus: EmailDeliveryStatus = "SKIPPED";
  if (changed) {
    const delivery = await sendShareEmailSafely({
      document,
      isPermissionUpdate: true,
      permission,
      recipient,
      sender,
    });
    notificationStatus = delivery.status;
  }

  return toDocumentShareResponse(share, notificationStatus);
};

export const resendDocumentShareEmail = async (
  documentId: string,
  shareId: string,
  ownerId: string,
): Promise<DocumentShareResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const sender = await User.findById(ownerId).select(
    "_id fullName email avatar",
  );
  if (!sender) {
    throw new AppError("Sharing user not found", 404);
  }

  const share = await DocumentShare.findOne({
    _id: shareId,
    documentId,
  }).populate("sharedWithUserId", "_id fullName email avatar");

  if (share) {
    const recipient = share.sharedWithUserId as unknown as PopulatedUser;
    const delivery = await sendShareEmailSafely({
      document,
      isPermissionUpdate: false,
      permission: share.permission,
      recipient,
      sender,
    });
    return toDocumentShareResponse(share, delivery.status);
  }

  const invitation = await DocumentShareInvitation.findOne({
    _id: shareId,
    documentId,
    expiresAt: { $gt: new Date() },
  }).select("+tokenCiphertext +tokenIv +tokenAuthTag");

  if (!invitation) {
    throw new AppError("Share not found", 404);
  }

  const delivery = await resendDocumentShareInvitation({
    document,
    invitation,
    sender,
  });

  return toPendingShareResponse(invitation, delivery.status);
};

export const revokeDocumentShare = async (
  documentId: string,
  shareId: string,
  ownerId: string,
): Promise<void> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const [shareResult, invitationResult] = await Promise.all([
    DocumentShare.deleteOne({ _id: shareId, documentId }),
    DocumentShareInvitation.deleteOne({ _id: shareId, documentId }),
  ]);

  if (shareResult.deletedCount === 0 && invitationResult.deletedCount === 0) {
    throw new AppError("Share not found", 404);
  }
};
