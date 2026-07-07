import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { StudyDocument } from "../documents/document.model";
import * as vectorService from "../../services/vector.service";
import {
  buildPaginationResponse,
  paginate,
  PaginationResponse,
} from "../../common/utils/pagination.util";
import { ISubject, Subject } from "./subject.model";
import {
  assertCanDeleteSubject,
  assertSubjectManageAccess,
  ensureSubjectOwnerMembership,
  ensureSubjectOwnerMemberships,
  getSubjectRole,
} from "./subjectAccess.service";
import {
  SubjectDocumentAccess,
  SubjectMember,
  SubjectMemberRole,
  SubjectTeam,
  SubjectTeamMember,
} from "./subjectWorkspace.model";

export interface CreateSubjectRequest {
  name: string;
  description?: string;
  color?: string;
  code?: string;
  semester?: string;
}

export interface UpdateSubjectRequest {
  name?: string;
  description?: string;
  color?: string;
  code?: string;
  semester?: string;
}

export interface ListSubjectQuery {
  page?: string;
  limit?: string;
  search?: string;
}

export interface SubjectResponse {
  _id: string;
  ownerId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  name: string;
  description?: string;
  color?: string;
  code?: string;
  semester?: string;
  documentCount: number;
  memberCount: number;
  teamCount: number;
  currentUserRole: SubjectMemberRole | null;
  currentUserTeams?: Array<{
    id: string;
    name: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSubjectPayload = <
  T extends CreateSubjectRequest | UpdateSubjectRequest,
>(
  payload: T,
): T => {
  const normalized = {
    ...payload,
    name: payload.name?.trim(),
    description: payload.description?.trim(),
    color: payload.color?.trim(),
    code: payload.code?.trim() || undefined,
  } as T;

  if (payload.semester !== undefined) {
    normalized.semester = payload.semester.trim();
  }

  return normalized;
};

const assertSubjectUnique = async (
  ownerId: string,
  payload: CreateSubjectRequest | UpdateSubjectRequest,
  excludedSubjectId?: string,
): Promise<void> => {
  const orFilters: Record<string, string>[] = [];

  if (payload.name) {
    orFilters.push({ name: payload.name });
  }

  if (payload.code) {
    orFilters.push({ code: payload.code });
  }

  if (orFilters.length === 0) {
    return;
  }

  const existingSubject = await Subject.findOne({
    ownerId,
    ...(excludedSubjectId ? { _id: { $ne: excludedSubjectId } } : {}),
    $or: orFilters,
  });

  if (!existingSubject) {
    return;
  }

  if (payload.name && existingSubject.name === payload.name) {
    throw new AppError("Subject name already exists", 409);
  }

  throw new AppError("Subject code already exists", 409);
};

export const toSubjectResponse = (
  subject: ISubject,
  options: {
    currentUserRole?: SubjectMemberRole | null;
    currentUserTeams?: Array<{ id: string; name: string }>;
    documentCount?: number;
    memberCount?: number;
    teamCount?: number;
  } = {},
): SubjectResponse => ({
  _id: subject._id.toString(),
  ownerId: subject.ownerId,
  userId: subject.ownerId,
  name: subject.name,
  description: subject.description,
  color: subject.color,
  code: subject.code,
  semester: subject.semester,
  documentCount: options.documentCount ?? 0,
  memberCount: options.memberCount ?? 1,
  teamCount: options.teamCount ?? 0,
  currentUserRole: options.currentUserRole ?? null,
  currentUserTeams: options.currentUserTeams ?? [],
  createdAt: subject.createdAt,
  updatedAt: subject.updatedAt,
});

const toCurrentUserTeam = (membership: {
  teamId?: unknown;
}): { id: string; name: string } | null => {
  const team = membership.teamId as { _id?: Types.ObjectId; name?: string } | null;
  if (!team?._id || !team.name) return null;
  return {
    id: team._id.toString(),
    name: team.name,
  };
};

const dedupeCurrentUserTeams = (
  teams: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> => {
  const unique = new Map<string, { id: string; name: string }>();
  for (const team of teams) {
    unique.set(team.id, team);
  }
  return [...unique.values()];
};

const getCurrentUserTeamsForSubjects = async (
  subjectIds: Types.ObjectId[],
  userId: string,
): Promise<Map<string, Array<{ id: string; name: string }>>> => {
  const teamsBySubjectId = new Map<string, Array<{ id: string; name: string }>>();
  if (subjectIds.length === 0) {
    return teamsBySubjectId;
  }

  const memberships = await SubjectTeamMember.find({
    userId,
    subjectId: { $in: subjectIds },
  }).populate("teamId", "_id name");

  for (const membership of memberships) {
    const team = toCurrentUserTeam(membership);
    if (!team) continue;
    const key = membership.subjectId.toString();
    teamsBySubjectId.set(key, dedupeCurrentUserTeams([...(teamsBySubjectId.get(key) ?? []), team]));
  }

  return teamsBySubjectId;
};

const withDocumentCount = (
  subject: ISubject,
  documentCount: number,
  options: Parameters<typeof toSubjectResponse>[1] = {},
): SubjectResponse => toSubjectResponse(subject, { ...options, documentCount });

const getActiveDocumentCount = async (
  ownerId: string,
  subjectId: string | Types.ObjectId,
): Promise<number> =>
  StudyDocument.countDocuments({
    ownerId,
    subjectId: new Types.ObjectId(subjectId.toString()),
    status: { $ne: "DELETED" },
  });

export const createSubject = async (
  ownerId: string,
  payload: CreateSubjectRequest,
): Promise<SubjectResponse> => {
  const normalizedPayload = normalizeSubjectPayload(payload);

  await assertSubjectUnique(ownerId, normalizedPayload);

  const subject = await Subject.create({
    ...normalizedPayload,
    ownerId,
  });

  await ensureSubjectOwnerMembership(subject);

  return withDocumentCount(subject, 0, {
    currentUserRole: "OWNER",
    memberCount: 1,
    teamCount: 0,
  });
};

export const getSubjectsByUser = async (
  ownerId: string,
  query: ListSubjectQuery = {},
): Promise<{ items: SubjectResponse[]; pagination: PaginationResponse }> => {
  const { page, limit, skip } = paginate(query);
  const membershipSubjectIds = await SubjectMember.distinct("subjectId", {
    userId: ownerId,
  });
  const visibilityFilter = {
    $or: [{ ownerId }, { _id: { $in: membershipSubjectIds } }],
  };
  const filters: Record<string, unknown> = visibilityFilter;

  if (query.search?.trim()) {
    const searchRegex = new RegExp(escapeRegex(query.search.trim()), "i");
    filters.$and = [
      visibilityFilter,
      {
        $or: [
          { name: searchRegex },
          { code: searchRegex },
          { description: searchRegex },
        ],
      },
    ];
    delete filters.$or;
  }

  const [subjects, totalItems] = await Promise.all([
    Subject.find(filters).sort({ name: 1, code: 1 }).skip(skip).limit(limit),
    Subject.countDocuments(filters),
  ]);

  await ensureSubjectOwnerMemberships(subjects);

  const subjectIds = subjects.map((subject) => subject._id);
  const [memberships, memberCounts, teamCounts, documentCounts, teamsBySubjectId] = await Promise.all([
    SubjectMember.find({
      userId: ownerId,
      subjectId: { $in: subjectIds },
    }).select("subjectId role"),
    SubjectMember.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { subjectId: { $in: subjectIds } } },
      { $group: { _id: "$subjectId", count: { $sum: 1 } } },
    ]),
    SubjectTeam.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { subjectId: { $in: subjectIds } } },
      { $group: { _id: "$subjectId", count: { $sum: 1 } } },
    ]),
    StudyDocument.aggregate<{
    _id: Types.ObjectId;
    count: number;
  }>([
    {
      $match: {
        subjectId: { $in: subjectIds },
        status: { $ne: "DELETED" },
      },
    },
    {
      $group: {
        _id: "$subjectId",
        count: { $sum: 1 },
      },
    },
  ]),
    getCurrentUserTeamsForSubjects(subjectIds, ownerId),
  ]);
  const countBySubjectId = new Map(
    documentCounts.map((item) => [item._id.toString(), item.count]),
  );
  const roleBySubjectId = new Map(
    memberships.map((item) => [item.subjectId.toString(), item.role]),
  );
  const memberCountBySubjectId = new Map(
    memberCounts.map((item) => [item._id.toString(), item.count]),
  );
  const teamCountBySubjectId = new Map(
    teamCounts.map((item) => [item._id.toString(), item.count]),
  );
  return {
    items: subjects.map((subject) =>
      withDocumentCount(subject, countBySubjectId.get(subject._id.toString()) || 0, {
        currentUserRole:
          subject.ownerId.toString() === ownerId
            ? "OWNER"
            : roleBySubjectId.get(subject._id.toString()) ?? null,
        currentUserTeams: teamsBySubjectId.get(subject._id.toString()) ?? [],
        memberCount: memberCountBySubjectId.get(subject._id.toString()) || 1,
        teamCount: teamCountBySubjectId.get(subject._id.toString()) || 0,
      }),
    ),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const getSubjectById = async (
  subjectId: string,
  ownerId: string,
  role = "user",
): Promise<SubjectResponse> => {
  const subject = await Subject.findById(subjectId);

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }
  const currentUserRole = await getSubjectRole(subjectId, ownerId, role);
  if (!currentUserRole) {
    throw new AppError("Subject not found", 404);
  }
  const [documentCount, memberCount, teamCount, teamsBySubjectId] = await Promise.all([
    getActiveDocumentCount(subject.ownerId.toString(), subjectId),
    SubjectMember.countDocuments({ subjectId }),
    SubjectTeam.countDocuments({ subjectId }),
    getCurrentUserTeamsForSubjects([subject._id], ownerId),
  ]);
  const currentUserTeams = teamsBySubjectId.get(subject._id.toString()) ?? [];

  return withDocumentCount(
    subject,
    documentCount,
    { currentUserRole, currentUserTeams: dedupeCurrentUserTeams(currentUserTeams), memberCount, teamCount },
  );
};

export const updateSubject = async (
  subjectId: string,
  ownerId: string,
  payload: UpdateSubjectRequest,
  role = "user",
): Promise<SubjectResponse> => {
  const normalizedPayload = normalizeSubjectPayload(payload);
  const currentUserRole =
    SubjectMember.db.readyState === 1
      ? await assertSubjectManageAccess(subjectId, ownerId, role)
      : "OWNER";
  const subjectForOwner =
    SubjectMember.db.readyState === 1
      ? await Subject.findOne({ _id: subjectId })
      : null;
  if (!subjectForOwner) {
    if (SubjectMember.db.readyState === 1) {
      throw new AppError("Subject not found", 404);
    }
  }

  await assertSubjectUnique(
    subjectForOwner?.ownerId.toString() ?? ownerId,
    normalizedPayload,
    subjectId,
  );

  const subject = await Subject.findOneAndUpdate(
    { _id: subjectId },
    normalizedPayload,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }

  return withDocumentCount(
    subject,
    await getActiveDocumentCount(subject.ownerId.toString(), subjectId),
    {
      currentUserRole,
      memberCount:
        SubjectMember.db.readyState === 1
          ? await SubjectMember.countDocuments({ subjectId })
          : 1,
      teamCount:
        SubjectMember.db.readyState === 1
          ? await SubjectTeam.countDocuments({ subjectId })
          : 0,
    },
  );
};

export const deleteSubject = async (
  subjectId: string,
  ownerId: string,
  role = "user",
): Promise<void> => {
  await assertCanDeleteSubject(subjectId, ownerId, role);
  const subject = await Subject.findOne({ _id: subjectId });

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }

  const documents = await StudyDocument.find({
    ownerId,
    subjectId: new Types.ObjectId(subjectId),
    status: { $ne: "DELETED" },
  });

  for (const document of documents) {
    const deletedAt = new Date();
    await StudyDocument.findByIdAndUpdate(
      document._id,
      {
        status: "DELETED",
        deletedAt,
        deletedBy: new Types.ObjectId(ownerId),
        ragStatus: "DELETE_PENDING",
        ragError: null,
        ragStatusUpdatedAt: deletedAt,
      },
      {
        runValidators: true,
      },
    );

    try {
      await vectorService.deleteDocumentChunks(document._id.toString());
      await StudyDocument.findByIdAndUpdate(
        document._id,
        {
          ragStatus: "DELETED",
          ragError: null,
          ragStatusUpdatedAt: new Date(),
          totalChunks: 0,
          lastIndexedAt: null,
        },
        {
          runValidators: true,
        },
      );
    } catch (error) {
      await StudyDocument.findByIdAndUpdate(
        document._id,
        {
          ragStatus: "DELETE_PENDING",
          ragError: error instanceof Error ? error.message : "Vector cleanup failed",
          ragStatusUpdatedAt: new Date(),
        },
        {
          runValidators: true,
        },
      );
    }
  }

  if (SubjectMember.db.readyState === 1) {
    await Promise.all([
      SubjectDocumentAccess.deleteMany({ subjectId }),
      SubjectTeamMember.deleteMany({ subjectId }),
      SubjectTeam.deleteMany({ subjectId }),
      SubjectMember.deleteMany({ subjectId }),
    ]);
  }
  await subject.deleteOne();
};
