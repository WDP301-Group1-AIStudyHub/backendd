import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { StudyDocument } from "../documents/document.model";
import {
  buildPaginationResponse,
  paginate,
  PaginationResponse,
} from "../../common/utils/pagination.util";
import { ISubject, Subject } from "./subject.model";

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

export const toSubjectResponse = (subject: ISubject): SubjectResponse => ({
  _id: subject._id.toString(),
  ownerId: subject.ownerId,
  userId: subject.ownerId,
  name: subject.name,
  description: subject.description,
  color: subject.color,
  code: subject.code,
  semester: subject.semester,
  createdAt: subject.createdAt,
  updatedAt: subject.updatedAt,
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

  return toSubjectResponse(subject);
};

export const getSubjectsByUser = async (
  ownerId: string,
  query: ListSubjectQuery = {},
): Promise<{ items: SubjectResponse[]; pagination: PaginationResponse }> => {
  const { page, limit, skip } = paginate(query);
  const filters: Record<string, unknown> = { ownerId };

  if (query.search?.trim()) {
    const searchRegex = new RegExp(escapeRegex(query.search.trim()), "i");
    filters.$or = [
      { name: searchRegex },
      { code: searchRegex },
      { description: searchRegex },
    ];
  }

  const [subjects, totalItems] = await Promise.all([
    Subject.find(filters).sort({ name: 1, code: 1 }).skip(skip).limit(limit),
    Subject.countDocuments(filters),
  ]);

  return {
    items: subjects.map(toSubjectResponse),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const getSubjectById = async (
  subjectId: string,
  ownerId: string,
): Promise<SubjectResponse> => {
  const subject = await Subject.findOne({ _id: subjectId, ownerId });

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }

  return toSubjectResponse(subject);
};

export const updateSubject = async (
  subjectId: string,
  ownerId: string,
  payload: UpdateSubjectRequest,
): Promise<SubjectResponse> => {
  const normalizedPayload = normalizeSubjectPayload(payload);

  await assertSubjectUnique(ownerId, normalizedPayload, subjectId);

  const subject = await Subject.findOneAndUpdate(
    { _id: subjectId, ownerId },
    normalizedPayload,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }

  return toSubjectResponse(subject);
};

export const deleteSubject = async (
  subjectId: string,
  ownerId: string,
): Promise<void> => {
  const subject = await Subject.findOne({ _id: subjectId, ownerId });

  if (!subject) {
    throw new AppError("Subject not found", 404);
  }

  const documentCount = await StudyDocument.countDocuments({
    ownerId,
    subjectId: new Types.ObjectId(subjectId),
  });

  if (documentCount > 0) {
    throw new AppError("Subject is being used by documents", 409);
  }

  await subject.deleteOne();
};
