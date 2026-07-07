import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { User } from "../../models/user.model";
import { EmailDeliveryStatus, sendSubjectWorkspaceEmail } from "../../services/email.service";
import { buildWebSubjectUrl } from "../../services/publicAppUrl.service";
import { StudyDocument } from "../documents/document.model";
import { DocumentResponse, toDocumentResponse } from "../documents/document.service";
import { Subject } from "./subject.model";
import { SubjectMemberInvitation } from "./subjectMemberInvitation.model";
import {
  createOrUpdateSubjectMemberInvitation,
  toPendingSubjectMemberResponse,
} from "./subjectMemberInvitation.service";
import {
  assertSubjectManageAccess,
  assertSubjectRole,
  getReadableSubjectDocumentIds,
  getSubjectDocumentAccessRole,
} from "./subjectAccess.service";
import {
  ISubjectDocumentAccess,
  ISubjectMember,
  ISubjectTeam,
  SubjectDocumentAccess,
  SubjectDocumentPermission,
  SubjectGrantType,
  SubjectMember,
  SubjectMemberRole,
  SubjectTeam,
  SubjectTeamMember,
} from "./subjectWorkspace.model";

type PopulatedUser = {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  avatar?: string;
};

type PopulatedTeam = {
  _id: Types.ObjectId;
  name: string;
};

export interface SubjectMemberResponse {
  id: string;
  subjectId: string;
  role: SubjectMemberRole;
  user: {
    id: string;
    fullName: string;
    email: string;
    avatar?: string;
  };
  status?: "ACTIVE" | "PENDING";
  teamId?: string;
  teamIds?: string[];
  teamNames?: string[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  notificationStatus?: EmailDeliveryStatus;
}

export interface SubjectTeamResponse {
  id: string;
  subjectId: string;
  name: string;
  description?: string;
  members: SubjectMemberResponse["user"][];
  pendingMembers?: SubjectMemberResponse["user"][];
  createdAt: Date;
  updatedAt: Date;
  notificationStatus?: EmailDeliveryStatus;
}

export interface SubjectDocumentAccessResponse {
  id: string;
  subjectId: string;
  documentId: string;
  granteeType: SubjectGrantType;
  granteeId: string;
  granteeName: string;
  granteeEmail?: string;
  permission: SubjectDocumentPermission;
  grantedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const toUserSummary = (value: unknown): SubjectMemberResponse["user"] => {
  const user = value as PopulatedUser;
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    avatar: user.avatar,
  };
};

const toMemberResponse = (member: ISubjectMember): SubjectMemberResponse => ({
  id: member._id.toString(),
  subjectId: member.subjectId.toString(),
  role: member.role,
  user: toUserSummary(member.userId),
  status: "ACTIVE",
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
});

const withMemberTeams = (
  member: SubjectMemberResponse,
  teamMembershipsByUser: Map<string, Array<{ id: string; name: string }>>,
): SubjectMemberResponse => {
  const teams = teamMembershipsByUser.get(member.user.id) ?? [];
  return {
    ...member,
    teamIds: teams.map((team) => team.id),
    teamNames: teams.map((team) => team.name),
  };
};

const assertDocumentBelongsToSubject = async (
  subjectId: string,
  documentId: string,
) => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    subjectId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found in this subject workspace", 404);
  }

  return document;
};

const assertMemberBelongsToSubject = async (
  subjectId: string,
  userId: string | Types.ObjectId,
): Promise<void> => {
  const member = await SubjectMember.findOne({ subjectId, userId }).select("_id");
  if (!member) {
    throw new AppError("User is not a member of this subject workspace", 400);
  }
};

const assertTeamBelongsToSubject = async (
  subjectId: string,
  teamId: string | Types.ObjectId,
): Promise<void> => {
  const team = await SubjectTeam.findOne({ _id: teamId, subjectId }).select("_id");
  if (!team) {
    throw new AppError("Team not found in this subject workspace", 404);
  }
};

export const listSubjectMembers = async (
  subjectId: string,
  userId: string,
  systemRole = "user",
): Promise<SubjectMemberResponse[]> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  const members = await SubjectMember.find({ subjectId })
    .populate("userId", "_id fullName email avatar")
    .sort({ role: 1, createdAt: 1 });
  const [invitations, teamMemberships, teams] = await Promise.all([
    SubjectMemberInvitation.find({
      subjectId,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }),
    SubjectTeamMember.find({ subjectId }).select("teamId userId"),
    SubjectTeam.find({ subjectId }).select("_id name"),
  ]);
  const teamNameById = new Map(teams.map((team) => [team._id.toString(), team.name]));
  const teamsByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const membership of teamMemberships) {
    const teamId = membership.teamId.toString();
    const userKey = membership.userId.toString();
    teamsByUser.set(userKey, [
      ...(teamsByUser.get(userKey) ?? []),
      { id: teamId, name: teamNameById.get(teamId) ?? "Team" },
    ]);
  }

  return [
    ...members.map((member) => withMemberTeams(toMemberResponse(member), teamsByUser)),
    ...invitations.map((invitation) => ({
      ...toPendingSubjectMemberResponse(invitation),
      teamIds: invitation.teamId ? [invitation.teamId.toString()] : [],
      teamNames: invitation.teamId
        ? [teamNameById.get(invitation.teamId.toString()) ?? "Team"]
        : [],
    })),
  ];
};

export const addSubjectMember = async (
  subjectId: string,
  userId: string,
  payload: { email: string; role?: SubjectMemberRole; teamId?: string },
  systemRole = "user",
): Promise<SubjectMemberResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  if (payload.teamId) {
    await assertTeamBelongsToSubject(subjectId, payload.teamId);
  }
  const [recipient, sender, subject] = await Promise.all([
    User.findOne({
      email: payload.email.toLowerCase().trim(),
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    }).select("_id fullName email avatar"),
    User.findById(userId).select("_id fullName email avatar"),
    Subject.findById(subjectId).select("_id name code semester"),
  ]);

  if (!sender) {
    throw new AppError("Current user was not found", 404);
  }
  if (!subject) {
    throw new AppError("Subject workspace not found", 404);
  }

  const role = payload.role === "ADMIN" ? "ADMIN" : "MEMBER";
  const team = payload.teamId
    ? await SubjectTeam.findOne({ _id: payload.teamId, subjectId }).select("_id name")
    : null;

  if (!recipient) {
    const { invitation, notificationStatus } =
      await createOrUpdateSubjectMemberInvitation({
        email: payload.email,
        invitedBy: userId,
        role,
        sender,
        subject,
        teamId: payload.teamId,
        teamName: team?.name,
      });

    return toPendingSubjectMemberResponse(invitation, notificationStatus);
  }

  const existingMember = await SubjectMember.findOne({
    subjectId,
    userId: recipient._id,
  }).select("_id role");
  const member = await SubjectMember.findOneAndUpdate(
    { subjectId, userId: recipient._id },
    {
      $set: { role },
      $setOnInsert: { subjectId, userId: recipient._id },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).populate("userId", "_id fullName email avatar");
  await SubjectMemberInvitation.deleteMany({
    subjectId,
    email: recipient.email.toLowerCase(),
  });

  const response = toMemberResponse(member);
  if (payload.teamId) {
    await SubjectTeamMember.findOneAndUpdate(
      { subjectId, teamId: payload.teamId, userId: recipient._id },
      {
        $setOnInsert: {
          subjectId,
          teamId: payload.teamId,
          userId: recipient._id,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
  if (!existingMember || existingMember.role !== role) {
    const delivery = await sendSubjectWorkspaceEmail({
      to: recipient.email,
      recipientName: recipient.fullName,
      senderName: sender.fullName,
      subjectName: subject.name,
      subjectCode: [subject.code, subject.semester].filter(Boolean).join(" / "),
      role,
      teamName: team?.name,
      workspaceUrl: buildWebSubjectUrl(subject._id.toString()),
      type: payload.teamId ? "TEAM_MEMBER_ADDED" : "WORKSPACE_MEMBER_ADDED",
    });
    response.notificationStatus = delivery.status;
  } else {
    response.notificationStatus = "SKIPPED";
  }

  return response;
};

export const updateSubjectMemberRole = async (
  subjectId: string,
  memberId: string,
  userId: string,
  role: SubjectMemberRole,
  systemRole = "user",
): Promise<SubjectMemberResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  if (role === "OWNER") {
    throw new AppError("Ownership transfer is not supported in this MVP", 400);
  }

  const current = await SubjectMember.findOne({ _id: memberId, subjectId });
  if (!current) {
    throw new AppError("Member not found", 404);
  }
  if (current.role === "OWNER") {
    throw new AppError("Workspace owner cannot be downgraded", 400);
  }

  current.role = role;
  await current.save();
  await current.populate("userId", "_id fullName email avatar");
  return toMemberResponse(current);
};

export const removeSubjectMember = async (
  subjectId: string,
  memberId: string,
  userId: string,
  systemRole = "user",
): Promise<void> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  const member = await SubjectMember.findOne({ _id: memberId, subjectId });
  if (!member) {
    const invitation = await SubjectMemberInvitation.findOne({
      _id: memberId,
      subjectId,
    });
    if (!invitation) {
      throw new AppError("Member not found", 404);
    }
    await invitation.deleteOne();
    return;
  }
  if (member.role === "OWNER") {
    throw new AppError("Workspace owner cannot be removed", 400);
  }

  await Promise.all([
    SubjectTeamMember.deleteMany({ subjectId, userId: member.userId }),
    SubjectDocumentAccess.deleteMany({
      subjectId,
      granteeType: "USER",
      granteeId: member.userId,
    }),
    member.deleteOne(),
  ]);
};

export const listSubjectTeams = async (
  subjectId: string,
  userId: string,
  systemRole = "user",
): Promise<SubjectTeamResponse[]> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  const teams = await SubjectTeam.find({ subjectId }).sort({ name: 1 });
  const teamMembers = await SubjectTeamMember.find({
    subjectId,
    teamId: { $in: teams.map((team) => team._id) },
  }).populate("userId", "_id fullName email avatar");
  const pendingInvitations = await SubjectMemberInvitation.find({
    subjectId,
    teamId: { $in: teams.map((team) => team._id) },
    expiresAt: { $gt: new Date() },
  });
  const membersByTeam = new Map<string, SubjectMemberResponse["user"][]>();
  const pendingByTeam = new Map<string, SubjectMemberResponse["user"][]>();

  for (const membership of teamMembers) {
    const key = membership.teamId.toString();
    membersByTeam.set(key, [
      ...(membersByTeam.get(key) ?? []),
      toUserSummary(membership.userId),
    ]);
  }
  for (const invitation of pendingInvitations) {
    if (!invitation.teamId) continue;
    const key = invitation.teamId.toString();
    pendingByTeam.set(key, [
      ...(pendingByTeam.get(key) ?? []),
      {
        id: "",
        fullName: "Pending invitation",
        email: invitation.email,
      },
    ]);
  }

  return teams.map((team) => ({
    id: team._id.toString(),
    subjectId: team.subjectId.toString(),
    name: team.name,
    description: team.description,
    members: membersByTeam.get(team._id.toString()) ?? [],
    pendingMembers: pendingByTeam.get(team._id.toString()) ?? [],
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  }));
};

export const createSubjectTeam = async (
  subjectId: string,
  userId: string,
  payload: { name: string; description?: string },
  systemRole = "user",
): Promise<SubjectTeamResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  const team = await SubjectTeam.create({
    subjectId,
    name: payload.name.trim(),
    description: payload.description?.trim() ?? "",
    createdBy: userId,
  });

  return {
    id: team._id.toString(),
    subjectId: team.subjectId.toString(),
    name: team.name,
    description: team.description,
    members: [],
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
};

export const updateSubjectTeam = async (
  subjectId: string,
  teamId: string,
  userId: string,
  payload: { name?: string; description?: string },
  systemRole = "user",
): Promise<SubjectTeamResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  const team = await SubjectTeam.findOneAndUpdate(
    { _id: teamId, subjectId },
    {
      ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
      ...(payload.description !== undefined
        ? { description: payload.description.trim() }
        : {}),
    },
    { new: true, runValidators: true },
  );

  if (!team) {
    throw new AppError("Team not found", 404);
  }

  const [response] = await listSubjectTeams(subjectId, userId, systemRole).then((teams) =>
    teams.filter((item) => item.id === team._id.toString()),
  );
  return response;
};

export const deleteSubjectTeam = async (
  subjectId: string,
  teamId: string,
  userId: string,
  systemRole = "user",
): Promise<void> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertTeamBelongsToSubject(subjectId, teamId);
  await Promise.all([
    SubjectDocumentAccess.deleteMany({
      subjectId,
      granteeType: "TEAM",
      granteeId: teamId,
    }),
    SubjectTeamMember.deleteMany({ subjectId, teamId }),
    SubjectTeam.deleteOne({ _id: teamId, subjectId }),
  ]);
};

export const addSubjectTeamMember = async (
  subjectId: string,
  teamId: string,
  userId: string,
  memberUserId: string,
  systemRole = "user",
): Promise<SubjectTeamResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertTeamBelongsToSubject(subjectId, teamId);
  await assertMemberBelongsToSubject(subjectId, memberUserId);
  const [subject, targetTeam, recipient, sender, existingMembership] = await Promise.all([
    Subject.findById(subjectId).select("_id name code semester"),
    SubjectTeam.findOne({ _id: teamId, subjectId }).select("_id name"),
    User.findById(memberUserId).select("_id fullName email avatar"),
    User.findById(userId).select("_id fullName email avatar"),
    SubjectTeamMember.findOne({ subjectId, teamId, userId: memberUserId }).select("_id"),
  ]);
  if (!subject) {
    throw new AppError("Subject workspace not found", 404);
  }
  if (!targetTeam) {
    throw new AppError("Team not found in this subject workspace", 404);
  }
  if (!recipient) {
    throw new AppError("Team member user not found", 404);
  }
  if (!sender) {
    throw new AppError("Current user was not found", 404);
  }
  await SubjectTeamMember.findOneAndUpdate(
    { teamId, userId: memberUserId },
    {
      $setOnInsert: {
        subjectId,
        teamId,
        userId: memberUserId,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  const [team] = await listSubjectTeams(subjectId, userId, systemRole).then((teams) =>
    teams.filter((item) => item.id === teamId),
  );
  if (!existingMembership) {
    const delivery = await sendSubjectWorkspaceEmail({
      to: recipient.email,
      recipientName: recipient.fullName,
      senderName: sender.fullName,
      subjectName: subject.name,
      subjectCode: [subject.code, subject.semester].filter(Boolean).join(" / "),
      teamName: targetTeam.name,
      workspaceUrl: buildWebSubjectUrl(subject._id.toString()),
      type: "TEAM_MEMBER_ADDED",
    });
    team.notificationStatus = delivery.status;
  } else {
    team.notificationStatus = "SKIPPED";
  }
  return team;
};

export const removeSubjectTeamMember = async (
  subjectId: string,
  teamId: string,
  memberUserId: string,
  userId: string,
  systemRole = "user",
): Promise<SubjectTeamResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertTeamBelongsToSubject(subjectId, teamId);
  await SubjectTeamMember.deleteOne({ subjectId, teamId, userId: memberUserId });

  const [team] = await listSubjectTeams(subjectId, userId, systemRole).then((teams) =>
    teams.filter((item) => item.id === teamId),
  );
  return team;
};

export const listSubjectDocuments = async (
  subjectId: string,
  userId: string,
  systemRole = "user",
): Promise<DocumentResponse[]> => {
  const subjectRole = await assertSubjectRole(
    subjectId,
    userId,
    ["OWNER", "ADMIN", "MEMBER"],
    systemRole,
  );
  const readableIds =
    subjectRole === "OWNER" || subjectRole === "ADMIN"
      ? []
      : await getReadableSubjectDocumentIds(userId, systemRole, subjectId);
  const documents = await StudyDocument.find({
    subjectId,
    status: { $ne: "DELETED" },
    ...(readableIds.length ? { _id: { $in: readableIds } } : {}),
    ...(subjectRole === "MEMBER" && readableIds.length === 0
      ? { _id: { $in: [] } }
      : {}),
  })
    .select("-extractedText")
    .populate("subjectId", "_id name description color code semester")
    .populate(
      "currentVersionId",
      "_id processingStatus processingStage processingProgress",
    )
    .sort({ updatedAt: -1 });

  return Promise.all(
    documents.map(async (document) => {
      const accessRole = await getSubjectDocumentAccessRole(
        document,
        userId,
        systemRole,
      );
      return toDocumentResponse(document, {
        accessRole: accessRole ?? undefined,
        isShared: accessRole !== "OWNER",
      });
    }),
  );
};

const loadAccessGrantee = async (
  grant: ISubjectDocumentAccess,
): Promise<PopulatedTeam | PopulatedUser> => {
  if (grant.granteeType === "TEAM") {
    const team = await SubjectTeam.findById(grant.granteeId).select("_id name");
    if (!team) {
      throw new AppError("Access team not found", 404);
    }
    return team as unknown as PopulatedTeam;
  }

  const user = await User.findById(grant.granteeId).select("_id fullName email avatar");
  if (!user) {
    throw new AppError("Access user not found", 404);
  }
  return user as unknown as PopulatedUser;
};

const toAccessResponse = (
  grant: ISubjectDocumentAccess,
  grantee: PopulatedTeam | PopulatedUser,
): SubjectDocumentAccessResponse => {
  return {
    id: grant._id.toString(),
    subjectId: grant.subjectId.toString(),
    documentId: grant.documentId.toString(),
    granteeType: grant.granteeType,
    granteeId: grantee._id.toString(),
    granteeName:
      grant.granteeType === "TEAM"
        ? (grantee as PopulatedTeam).name
        : (grantee as PopulatedUser).fullName,
    granteeEmail:
      grant.granteeType === "USER"
        ? (grantee as PopulatedUser).email
        : undefined,
    permission: grant.permission,
    grantedBy: grant.grantedBy.toString(),
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
};

export const listDocumentAccess = async (
  subjectId: string,
  documentId: string,
  userId: string,
  systemRole = "user",
): Promise<SubjectDocumentAccessResponse[]> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertDocumentBelongsToSubject(subjectId, documentId);
  const grants = await SubjectDocumentAccess.find({ subjectId, documentId })
    .sort({ granteeType: 1, createdAt: -1 });

  return Promise.all(
    grants.map(async (grant) => toAccessResponse(grant, await loadAccessGrantee(grant))),
  );
};

export const createDocumentAccess = async (
  subjectId: string,
  documentId: string,
  userId: string,
  payload: {
    granteeType: SubjectGrantType;
    granteeId: string;
    permission: SubjectDocumentPermission;
  },
  systemRole = "user",
): Promise<SubjectDocumentAccessResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertDocumentBelongsToSubject(subjectId, documentId);
  if (payload.granteeType === "USER") {
    await assertMemberBelongsToSubject(subjectId, payload.granteeId);
  } else {
    await assertTeamBelongsToSubject(subjectId, payload.granteeId);
  }

  const grant = await SubjectDocumentAccess.findOneAndUpdate(
    {
      documentId,
      granteeType: payload.granteeType,
      granteeId: payload.granteeId,
    },
    {
      $set: {
        permission: payload.permission,
        grantedBy: userId,
        subjectId,
        documentId,
        granteeType: payload.granteeType,
        granteeId: payload.granteeId,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  return toAccessResponse(grant, await loadAccessGrantee(grant));
};

export const updateDocumentAccess = async (
  subjectId: string,
  documentId: string,
  grantId: string,
  userId: string,
  permission: SubjectDocumentPermission,
  systemRole = "user",
): Promise<SubjectDocumentAccessResponse> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertDocumentBelongsToSubject(subjectId, documentId);
  const grant = await SubjectDocumentAccess.findOneAndUpdate(
    { _id: grantId, subjectId, documentId },
    { permission, grantedBy: userId },
    { new: true, runValidators: true },
  );

  if (!grant) {
    throw new AppError("Access grant not found", 404);
  }

  return toAccessResponse(grant, await loadAccessGrantee(grant));
};

export const revokeDocumentAccess = async (
  subjectId: string,
  documentId: string,
  grantId: string,
  userId: string,
  systemRole = "user",
): Promise<void> => {
  await assertSubjectManageAccess(subjectId, userId, systemRole);
  await assertDocumentBelongsToSubject(subjectId, documentId);
  const result = await SubjectDocumentAccess.deleteOne({
    _id: grantId,
    subjectId,
    documentId,
  });

  if (result.deletedCount === 0) {
    throw new AppError("Access grant not found", 404);
  }
};
