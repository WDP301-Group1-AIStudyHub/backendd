import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { DocumentShare } from "../documentShares/documentShare.model";
import { IDocument, StudyDocument } from "../documents/document.model";
import { ISubject, Subject } from "./subject.model";
import {
  SubjectDocumentAccess,
  SubjectDocumentPermission,
  SubjectMember,
  SubjectMemberRole,
  SubjectTeamMember,
} from "./subjectWorkspace.model";

export type SubjectDocumentAccessRole = "OWNER" | "EDITOR" | "VIEWER";
export type RequiredSubjectRole = "OWNER" | "ADMIN" | "MEMBER";

const roleRank: Record<SubjectMemberRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

const permissionRank: Record<SubjectDocumentPermission, number> = {
  VIEW: 1,
  EDIT: 2,
};

const hasDatabaseConnection = (): boolean => SubjectMember.db.readyState === 1;

const toObjectId = (value: unknown): Types.ObjectId | null => {
  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (typeof value === "string" && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }

  if (value && typeof value === "object" && "_id" in value) {
    return toObjectId((value as { _id?: unknown })._id);
  }

  return null;
};

export const permissionToSubjectAccessRole = (
  permission: SubjectDocumentPermission,
): SubjectDocumentAccessRole => (permission === "EDIT" ? "EDITOR" : "VIEWER");

export const ensureSubjectOwnerMembership = async (
  subject: Pick<ISubject, "_id" | "ownerId">,
): Promise<void> => {
  if (!hasDatabaseConnection()) {
    return;
  }

  await SubjectMember.findOneAndUpdate(
    { subjectId: subject._id, userId: subject.ownerId },
    {
      $setOnInsert: {
        subjectId: subject._id,
        userId: subject.ownerId,
        role: "OWNER",
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
};

export const ensureSubjectOwnerMemberships = async (
  subjects: Array<Pick<ISubject, "_id" | "ownerId">>,
): Promise<void> => {
  await Promise.all(subjects.map((subject) => ensureSubjectOwnerMembership(subject)));
};

export const getSubjectRole = async (
  subjectId: string | Types.ObjectId | { _id?: unknown },
  userId: string,
  systemRole = "user",
): Promise<SubjectMemberRole | null> => {
  if (systemRole === "admin") {
    return "OWNER";
  }
  const subjectObjectId = toObjectId(subjectId);
  if (!subjectObjectId) {
    return null;
  }

  const subject = await Subject.findOne({ _id: subjectObjectId });
  if (!subject?.ownerId) {
    return null;
  }

  if (subject.ownerId.toString() === userId) {
    await ensureSubjectOwnerMembership(subject);
    return "OWNER";
  }

  const membership = await SubjectMember.findOne({
    subjectId: subjectObjectId,
    userId,
  }).select("role");

  return membership?.role ?? null;
};

export const assertSubjectRole = async (
  subjectId: string | Types.ObjectId,
  userId: string,
  allowedRoles: SubjectMemberRole[],
  systemRole = "user",
): Promise<SubjectMemberRole> => {
  const role = await getSubjectRole(subjectId, userId, systemRole);

  if (!role || !allowedRoles.includes(role)) {
    throw new AppError("You do not have permission for this subject workspace", 403);
  }

  return role;
};

export const assertSubjectManageAccess = async (
  subjectId: string | Types.ObjectId,
  userId: string,
  systemRole = "user",
): Promise<SubjectMemberRole> =>
  assertSubjectRole(subjectId, userId, ["OWNER", "ADMIN"], systemRole);

export const assertCanDeleteSubject = async (
  subjectId: string | Types.ObjectId,
  userId: string,
  systemRole = "user",
): Promise<void> => {
  await assertSubjectRole(subjectId, userId, ["OWNER"], systemRole);
};

export const getSubjectDocumentAccessRole = async (
  document: Pick<IDocument, "_id" | "ownerId" | "subjectId">,
  userId: string,
  systemRole = "user",
): Promise<SubjectDocumentAccessRole | null> => {
  if (systemRole === "admin" || document.ownerId.toString() === userId) {
    return "OWNER";
  }
  const subjectObjectId = toObjectId(document.subjectId);
  if (!subjectObjectId) {
    return null;
  }

  const subjectRole = await getSubjectRole(subjectObjectId, userId, systemRole);
  if (subjectRole === "OWNER" || subjectRole === "ADMIN") {
    return "OWNER";
  }

  if (subjectRole !== "MEMBER") {
    return null;
  }

  const teamIds = await SubjectTeamMember.distinct("teamId", {
    subjectId: subjectObjectId,
    userId,
  });
  const [grants, legacyShare] = await Promise.all([
    SubjectDocumentAccess.find({
    documentId: document._id,
    subjectId: subjectObjectId,
    $or: [
      { granteeType: "USER", granteeId: new Types.ObjectId(userId) },
      { granteeType: "TEAM", granteeId: { $in: teamIds } },
    ],
    }).select("permission"),
    DocumentShare.findOne({
      documentId: document._id,
      sharedWithUserId: new Types.ObjectId(userId),
    }).select("permission"),
  ]);

  const highest = grants.reduce<SubjectDocumentPermission | null>(
    (current, grant) => {
      const permission = grant.permission as SubjectDocumentPermission;
      if (!current || permissionRank[permission] > permissionRank[current]) {
        return permission;
      }
      return current;
    },
    null,
  );
  const legacyPermission = legacyShare?.permission as SubjectDocumentPermission | undefined;
  if (
    legacyPermission &&
    (!highest || permissionRank[legacyPermission] > permissionRank[highest])
  ) {
    return permissionToSubjectAccessRole(legacyPermission);
  }

  return highest ? permissionToSubjectAccessRole(highest) : null;
};

export const getReadableSubjectDocumentIds = async (
  userId: string,
  systemRole = "user",
  subjectId?: string,
): Promise<string[]> => {
  if (systemRole === "admin") {
    return [];
  }
  if (!hasDatabaseConnection()) {
    return [];
  }

  const subjectFilter = subjectId ? { subjectId: new Types.ObjectId(subjectId) } : {};
  const memberships = await SubjectMember.find({
    userId,
    ...subjectFilter,
  }).select("subjectId role");
  const managedSubjectIds = memberships
    .filter((membership) => membership.role === "OWNER" || membership.role === "ADMIN")
    .map((membership) => membership.subjectId);
  const teamIds = await SubjectTeamMember.distinct("teamId", {
    userId,
    ...subjectFilter,
  });
  const [grants, legacySharedIds] = await Promise.all([
    SubjectDocumentAccess.find({
      ...subjectFilter,
      $or: [
        { granteeType: "USER", granteeId: new Types.ObjectId(userId) },
        { granteeType: "TEAM", granteeId: { $in: teamIds } },
      ],
    }).select("documentId"),
    DocumentShare.distinct("documentId", {
      sharedWithUserId: new Types.ObjectId(userId),
    }),
  ]);
  const legacySubjectDocumentIds = legacySharedIds.length
    ? await StudyDocument.distinct("_id", {
        _id: { $in: legacySharedIds },
        ...(subjectId ? { subjectId: new Types.ObjectId(subjectId) } : {}),
        status: { $ne: "DELETED" },
      })
    : [];

  const [managedDocumentIds] = await Promise.all([
    managedSubjectIds.length
      ? StudyDocument.distinct("_id", {
          subjectId: { $in: managedSubjectIds },
          status: { $ne: "DELETED" },
        })
      : Promise.resolve([]),
  ]);
  const ids = new Set<string>([
    ...managedDocumentIds.map((id) => id.toString()),
    ...grants.map((grant) => grant.documentId.toString()),
    ...legacySubjectDocumentIds.map((id) => id.toString()),
  ]);

  return [...ids];
};

export const getSubjectAccessLabel = (role: SubjectMemberRole | null): string =>
  role ? role[0] + role.slice(1).toLowerCase() : "No access";
