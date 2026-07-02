import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { sendDocumentShareEmail } from "../../services/email.service";
import { DocumentShare, DocumentSharePermission } from "./documentShare.model";
import {
  DocumentShareInvitation,
  IDocumentShareInvitation,
} from "./documentShareInvitation.model";
import { StudyDocument } from "../documents/document.model";
import {
  buildMobileRegistrationUrl,
  buildWebRegistrationUrl,
} from "../../services/publicAppUrl.service";

const INVITATION_TTL_DAYS = 7;

type InvitationPerson = {
  fullName: string;
  email: string;
};

type InvitationDocument = {
  _id: Types.ObjectId;
  title: string;
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const toPendingShareResponse = (invitation: IDocumentShareInvitation) => ({
  id: invitation._id.toString(),
  documentId: invitation.documentId.toString(),
  sharedWithUser: {
    id: "",
    fullName: "Pending invitation",
    email: invitation.email,
  },
  permission: invitation.permission,
  sharedBy: invitation.sharedBy.toString(),
  status: "PENDING" as const,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  updatedAt: invitation.updatedAt,
});

export const createOrUpdateInvitation = async ({
  document,
  email,
  permission,
  sender,
  sharedBy,
}: {
  document: InvitationDocument;
  email: string;
  permission: DocumentSharePermission;
  sender: InvitationPerson;
  sharedBy: string;
}) => {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const normalizedEmail = email.trim().toLowerCase();

  const invitation = await DocumentShareInvitation.findOneAndUpdate(
    { documentId: document._id, email: normalizedEmail },
    {
      documentId: document._id,
      email: normalizedEmail,
      permission,
      sharedBy: new Types.ObjectId(sharedBy),
      tokenHash: hashToken(token),
      expiresAt,
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  const registrationUrl = buildWebRegistrationUrl(token, normalizedEmail);
  const mobileRegistrationUrl = buildMobileRegistrationUrl(
    token,
    normalizedEmail,
  );

  try {
    await sendDocumentShareEmail({
      to: normalizedEmail,
      recipientName: "",
      senderName: sender.fullName,
      documentTitle: document.title,
      permission,
      documentUrl: registrationUrl,
      mobileUrl: mobileRegistrationUrl,
      isInvitation: true,
    });
  } catch (error) {
    console.warn("[document-share] Failed to send invitation email", {
      documentId: document._id.toString(),
      recipient: normalizedEmail,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return invitation;
};

export const claimDocumentShareInvitations = async (
  email: string,
  userId: string,
  inviteToken: string,
): Promise<string | undefined> => {
  const normalizedEmail = email.trim().toLowerCase();
  const filter: Record<string, unknown> = {
    email: normalizedEmail,
    expiresAt: { $gt: new Date() },
  };

  filter.tokenHash = hashToken(inviteToken);

  const invitations = await DocumentShareInvitation.find(filter).sort({
    createdAt: -1,
  });

  if (invitations.length === 0) {
    return undefined;
  }

  const activeChecks = await Promise.all(
    invitations.map((invitation) =>
      StudyDocument.exists({
        _id: invitation.documentId,
        status: { $ne: "DELETED" },
      }),
    ),
  );
  const activeInvitations = invitations.filter((_, index) => activeChecks[index]);

  if (activeInvitations.length === 0) {
    return undefined;
  }

  await Promise.all(
    activeInvitations.map((invitation) =>
      DocumentShare.findOneAndUpdate(
        {
          documentId: invitation.documentId,
          sharedWithUserId: new Types.ObjectId(userId),
        },
        {
          permission: invitation.permission,
          sharedBy: invitation.sharedBy,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ),
    ),
  );

  await DocumentShareInvitation.deleteMany({
    _id: { $in: activeInvitations.map((invitation) => invitation._id) },
  });

  return activeInvitations[0].documentId.toString();
};

export const validateDocumentShareInvitation = async (
  email: string,
  inviteToken: string,
): Promise<void> => {
  const invitation = await DocumentShareInvitation.findOne({
    email: email.trim().toLowerCase(),
    tokenHash: hashToken(inviteToken),
    expiresAt: { $gt: new Date() },
  }).select("_id documentId");

  const documentExists = invitation
    ? await StudyDocument.exists({
        _id: invitation.documentId,
        status: { $ne: "DELETED" },
      })
    : null;

  if (!invitation || !documentExists) {
    throw new AppError(
      "Lời mời không hợp lệ, đã hết hạn hoặc không dành cho email này",
      400,
    );
  }
};
