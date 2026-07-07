import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import {
  EmailDeliveryStatus,
  sendSubjectWorkspaceEmail,
} from "../../services/email.service";
import { buildWebRegistrationUrl } from "../../services/publicAppUrl.service";
import { Subject } from "./subject.model";
import {
  SubjectMember,
  SubjectMemberRole,
  SubjectTeam,
  SubjectTeamMember,
} from "./subjectWorkspace.model";
import {
  ISubjectMemberInvitation,
  SubjectMemberInvitation,
} from "./subjectMemberInvitation.model";

const INVITATION_TTL_DAYS = 7;

type InvitationPerson = {
  fullName: string;
  email: string;
};

type InvitationSubject = {
  _id: Types.ObjectId;
  name: string;
  code?: string;
  semester?: string;
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
    ISubjectMemberInvitation,
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

export const toPendingSubjectMemberResponse = (
  invitation: ISubjectMemberInvitation,
  notificationStatus?: EmailDeliveryStatus,
) => ({
  id: invitation._id.toString(),
  subjectId: invitation.subjectId.toString(),
  role: invitation.role,
  user: {
    id: "",
    fullName: "Pending invitation",
    email: invitation.email,
  },
  status: "PENDING" as const,
  teamId: invitation.teamId?.toString(),
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  updatedAt: invitation.updatedAt,
  ...(notificationStatus ? { notificationStatus } : {}),
});

const deliverInvitationEmail = async ({
  email,
  role,
  sender,
  subject,
  teamName,
  token,
}: {
  email: string;
  role: SubjectMemberRole;
  sender: InvitationPerson;
  subject: InvitationSubject;
  teamName?: string;
  token: string;
}) =>
  sendSubjectWorkspaceEmail({
    to: email,
    recipientName: "",
    senderName: sender.fullName,
    subjectName: subject.name,
    subjectCode: [subject.code, subject.semester].filter(Boolean).join(" / "),
    role,
    teamName,
    workspaceUrl: buildWebRegistrationUrl(token, email),
    type: teamName ? "TEAM_MEMBER_INVITED" : "WORKSPACE_MEMBER_INVITED",
  });

export const createOrUpdateSubjectMemberInvitation = async ({
  email,
  invitedBy,
  role,
  sender,
  subject,
  teamId,
  teamName,
}: {
  email: string;
  invitedBy: string;
  role: SubjectMemberRole;
  sender: InvitationPerson;
  subject: InvitationSubject;
  teamId?: string;
  teamName?: string;
}) => {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const normalizedEmail = email.trim().toLowerCase();
  const encryptedToken = encryptInvitationToken(token);

  const invitation = await SubjectMemberInvitation.findOneAndUpdate(
    {
      subjectId: subject._id,
      email: normalizedEmail,
      teamId: teamId ? new Types.ObjectId(teamId) : undefined,
    },
    {
      $set: {
        subjectId: subject._id,
        email: normalizedEmail,
        role,
        invitedBy: new Types.ObjectId(invitedBy),
        ...(teamId ? { teamId: new Types.ObjectId(teamId) } : {}),
        tokenHash: hashToken(token),
        ...encryptedToken,
        expiresAt,
      },
      ...(teamId ? {} : { $unset: { teamId: "" } }),
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  const delivery = await deliverInvitationEmail({
    email: normalizedEmail,
    role,
    sender,
    subject,
    teamName,
    token,
  });

  return { invitation, notificationStatus: delivery.status };
};

export const claimSubjectMemberInvitations = async (
  email: string,
  userId: string,
  inviteToken: string,
): Promise<string | undefined> => {
  const normalizedEmail = email.trim().toLowerCase();
  const invitations = await SubjectMemberInvitation.find({
    email: normalizedEmail,
    tokenHash: hashToken(inviteToken),
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (invitations.length === 0) {
    return undefined;
  }

  const subjects = await Subject.find({
    _id: { $in: invitations.map((invitation) => invitation.subjectId) },
  }).select("_id");
  const subjectIds = new Set(subjects.map((subject) => subject._id.toString()));
  const activeInvitations = invitations.filter((invitation) =>
    subjectIds.has(invitation.subjectId.toString()),
  );

  if (activeInvitations.length === 0) {
    return undefined;
  }

  await Promise.all(
    activeInvitations.map(async (invitation) => {
      await SubjectMember.findOneAndUpdate(
        { subjectId: invitation.subjectId, userId: new Types.ObjectId(userId) },
        {
          $set: { role: invitation.role === "ADMIN" ? "ADMIN" : "MEMBER" },
          $setOnInsert: {
            subjectId: invitation.subjectId,
            userId: new Types.ObjectId(userId),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      if (invitation.teamId) {
        const teamExists = await SubjectTeam.exists({
          _id: invitation.teamId,
          subjectId: invitation.subjectId,
        });
        if (teamExists) {
          await SubjectTeamMember.findOneAndUpdate(
            {
              subjectId: invitation.subjectId,
              teamId: invitation.teamId,
              userId: new Types.ObjectId(userId),
            },
            {
              $setOnInsert: {
                subjectId: invitation.subjectId,
                teamId: invitation.teamId,
                userId: new Types.ObjectId(userId),
              },
            },
            { upsert: true, setDefaultsOnInsert: true },
          );
        }
      }
    }),
  );

  await SubjectMemberInvitation.deleteMany({
    _id: { $in: activeInvitations.map((invitation) => invitation._id) },
  });

  return activeInvitations[0].subjectId.toString();
};

export const validateSubjectMemberInvitation = async (
  email: string,
  inviteToken: string,
): Promise<void> => {
  const invitation = await SubjectMemberInvitation.findOne({
    email: email.trim().toLowerCase(),
    tokenHash: hashToken(inviteToken),
    expiresAt: { $gt: new Date() },
  }).select("_id subjectId");

  const subjectExists = invitation
    ? await Subject.exists({ _id: invitation.subjectId })
    : null;

  if (!invitation || !subjectExists) {
    throw new AppError(
      "Lời mời không hợp lệ, đã hết hạn hoặc không dành cho email này",
      400,
    );
  }
};

export const resendSubjectMemberInvitation = async ({
  invitation,
  sender,
  subject,
  teamName,
}: {
  invitation: ISubjectMemberInvitation;
  sender: InvitationPerson;
  subject: InvitationSubject;
  teamName?: string;
}) => {
  let token = decryptInvitationToken(invitation);

  if (!token) {
    token = randomBytes(32).toString("hex");
    const encryptedToken = encryptInvitationToken(token);
    await SubjectMemberInvitation.updateOne(
      { _id: invitation._id },
      { tokenHash: hashToken(token), ...encryptedToken },
    );
  }

  return deliverInvitationEmail({
    email: invitation.email,
    role: invitation.role,
    sender,
    subject,
    teamName,
    token,
  });
};
