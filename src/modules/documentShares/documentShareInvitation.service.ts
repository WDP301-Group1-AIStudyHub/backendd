import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import {
  EmailDeliveryResult,
  EmailDeliveryStatus,
  sendDocumentShareEmail,
} from "../../services/email.service";
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

const getInvitationEncryptionKey = (): Buffer => {
  const secret =
    process.env.INVITATION_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "development-only-secret");

  if (!secret) {
    throw new Error(
      "INVITATION_TOKEN_SECRET or JWT_SECRET is required in production",
    );
  }

  return createHash("sha256").update(secret).digest();
};

const encryptInvitationToken = (token: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getInvitationEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
  };
};

const decryptInvitationToken = (
  invitation: Pick<
    IDocumentShareInvitation,
    "tokenCiphertext" | "tokenIv" | "tokenAuthTag"
  >,
): string | null => {
  if (
    !invitation.tokenCiphertext ||
    !invitation.tokenIv ||
    !invitation.tokenAuthTag
  ) {
    return null;
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getInvitationEncryptionKey(),
    Buffer.from(invitation.tokenIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(invitation.tokenAuthTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(invitation.tokenCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

export const toPendingShareResponse = (
  invitation: IDocumentShareInvitation,
  notificationStatus?: EmailDeliveryStatus,
) => ({
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
  ...(notificationStatus ? { notificationStatus } : {}),
});

const deliverInvitationEmail = async ({
  document,
  email,
  permission,
  sender,
  token,
}: {
  document: InvitationDocument;
  email: string;
  permission: DocumentSharePermission;
  sender: InvitationPerson;
  token: string;
}): Promise<EmailDeliveryResult> =>
  sendDocumentShareEmail({
    to: email,
    recipientName: "",
    senderName: sender.fullName,
    documentTitle: document.title,
    permission,
    documentUrl: buildWebRegistrationUrl(token, email),
    mobileUrl: buildMobileRegistrationUrl(token, email),
    isInvitation: true,
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
  const encryptedToken = encryptInvitationToken(token);

  const invitation = await DocumentShareInvitation.findOneAndUpdate(
    { documentId: document._id, email: normalizedEmail },
    {
      documentId: document._id,
      email: normalizedEmail,
      permission,
      sharedBy: new Types.ObjectId(sharedBy),
      tokenHash: hashToken(token),
      ...encryptedToken,
      expiresAt,
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  const delivery = await deliverInvitationEmail({
    document,
    email: normalizedEmail,
    permission,
    sender,
    token,
  });

  return { invitation, notificationStatus: delivery.status };
};

export const resendDocumentShareInvitation = async ({
  document,
  invitation,
  sender,
}: {
  document: InvitationDocument;
  invitation: IDocumentShareInvitation;
  sender: InvitationPerson;
}): Promise<EmailDeliveryResult> => {
  let token = decryptInvitationToken(invitation);

  if (!token) {
    token = randomBytes(32).toString("hex");
    const encryptedToken = encryptInvitationToken(token);
    await DocumentShareInvitation.updateOne(
      { _id: invitation._id },
      { tokenHash: hashToken(token), ...encryptedToken },
    );
  }

  return deliverInvitationEmail({
    document,
    email: invitation.email,
    permission: invitation.permission,
    sender,
    token,
  });
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
