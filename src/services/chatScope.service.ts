import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { DocumentShare } from "../modules/documentShares/documentShare.model";
import { getDocumentAccessRole } from "../modules/documentShares/documentShare.service";
import { AskQuestionRequest } from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import { VectorSearchFilters } from "./vector.service";

export type ChatScope =
  | "single_document"
  | "subject_all"
  | "document_set"
  | "library_all";

type ActiveVersionProcessingSnapshot = {
  processingStatus?: string;
  indexedAt?: Date | null;
  totalChunks?: number;
};

export interface ResolvedChatScope {
  scope: ChatScope;
  documentId?: string;
  documentIds?: string[];
  subjectId?: string;
  subject?: string;
  documentTitle?: string;
  hasProcessingDocument: boolean;
  vectorFilters: VectorSearchFilters;
  isMultiDocumentScope: boolean;
}

const isActiveVersionReadyForChat = (
  activeVersion: ActiveVersionProcessingSnapshot | null,
): boolean => {
  if (!activeVersion) {
    return true;
  }

  if (activeVersion.processingStatus === "INDEXED") {
    return true;
  }

  if (activeVersion.indexedAt) {
    return true;
  }

  return (activeVersion.totalChunks ?? 0) > 0;
};

const uniqueIds = (ids: string[] | undefined): string[] | undefined => {
  const normalized = [...new Set((ids || []).map((id) => id.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
};

const getSubjectNameForUser = async (
  subjectId: string | undefined,
  userId: string,
): Promise<string | undefined> => {
  if (!subjectId) {
    return undefined;
  }

  const subject = await Subject.findOne({ _id: subjectId, ownerId: userId });

  if (!subject) {
    throw new AppError("Subject not found or does not belong to user", 400);
  }

  return subject.name;
};

const getSubjectNameById = async (
  subjectId: string | undefined,
): Promise<string | undefined> => {
  if (!subjectId) {
    return undefined;
  }

  const subject = await Subject.findById(subjectId).select("name");

  return subject?.name;
};

type SharePersonalSubject = {
  _id?: Types.ObjectId;
  name?: string;
};

type ShareWithPersonalSubject = {
  documentId: Types.ObjectId;
  personalSubjectId?: Types.ObjectId | SharePersonalSubject | null;
};

const getPersonalSubjectId = (
  share: ShareWithPersonalSubject | undefined,
): string | undefined => {
  const value = share?.personalSubjectId;

  if (!value) {
    return undefined;
  }

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === "object" && "_id" in value && value._id) {
    return value._id.toString();
  }

  return undefined;
};

const getPersonalSubjectName = (
  share: ShareWithPersonalSubject | undefined,
): string | undefined => {
  const value = share?.personalSubjectId;

  if (value && typeof value === "object" && !(value instanceof Types.ObjectId)) {
    return value.name;
  }

  return undefined;
};

const getShareMapForDocuments = async (
  userId: string,
  documentIds: Types.ObjectId[],
): Promise<Map<string, ShareWithPersonalSubject>> => {
  if (documentIds.length === 0 || !Types.ObjectId.isValid(userId)) {
    return new Map();
  }

  const shares = await DocumentShare.find({
    documentId: { $in: documentIds },
    sharedWithUserId: userId,
  })
    .select("documentId personalSubjectId")
    .populate("personalSubjectId", "_id name");

  return new Map(
    shares.map((share) => [
      share.documentId.toString(),
      share as unknown as ShareWithPersonalSubject,
    ]),
  );
};

const getSharedDocumentIds = async (
  userId: string,
  personalSubjectId?: string,
): Promise<string[]> => {
  if (!Types.ObjectId.isValid(userId)) {
    return [];
  }

  return (await DocumentShare.distinct("documentId", {
    sharedWithUserId: userId,
    ...(personalSubjectId ? { personalSubjectId } : {}),
  })).map(
    (id) => id.toString(),
  );
};

const areAllActiveVersionsReady = async (
  documents: Array<{ _id: Types.ObjectId; currentVersionId?: Types.ObjectId | null }>,
): Promise<boolean> => {
  const versionChecks = await Promise.all(
    documents
      .filter((document) => document.currentVersionId)
      .map((document) =>
        DocumentVersion.findOne({
          _id: document.currentVersionId,
          documentId: document._id,
          isActive: true,
          deletedAt: null,
        }).select("processingStatus indexedAt totalChunks"),
      ),
  );

  return versionChecks.every((activeVersion) =>
    isActiveVersionReadyForChat(activeVersion),
  );
};

export const resolveChatScope = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<ResolvedChatScope> => {
  if (payload.documentId && payload.documentIds?.length) {
    throw new AppError("Use either documentId or documentIds, not both", 400);
  }

  const documentIds = uniqueIds(payload.documentIds);

  if (payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: payload.documentId,
      status: { $ne: "DELETED" },
    }).select("_id ownerId visibility title subjectId currentVersionId");

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    const accessRole = await getDocumentAccessRole(document, userId);

    if (!accessRole) {
      throw new AppError("Document not found", 404);
    }

    const isOwner = document.ownerId.toString() === userId;
    const share = accessRole === "OWNER"
      ? undefined
      : (
          await DocumentShare.findOne({
            documentId: document._id,
            sharedWithUserId: userId,
          })
            .select("documentId personalSubjectId")
            .populate("personalSubjectId", "_id name")
        ) as unknown as ShareWithPersonalSubject | undefined;
    const subjectId = accessRole === "OWNER"
      ? document.subjectId?.toString()
      : getPersonalSubjectId(share);
    const subject =
      (accessRole === "OWNER"
        ? isOwner
          ? await getSubjectNameForUser(subjectId, userId)
          : await getSubjectNameById(subjectId)
        : getPersonalSubjectName(share)) || payload.subject;
    const hasProcessingDocument = !(await areAllActiveVersionsReady([document]));

    return {
      scope: "single_document",
      documentId: document._id.toString(),
      subjectId,
      subject,
      documentTitle: document.title,
      hasProcessingDocument,
      isMultiDocumentScope: false,
      vectorFilters: {
        documentId: document._id.toString(),
      },
    };
  }

  if (documentIds?.length) {
    const documents = await StudyDocument.find({
      _id: { $in: documentIds },
      status: { $ne: "DELETED" },
    }).select("_id ownerId visibility title subjectId currentVersionId");

    if (documents.length !== documentIds.length) {
      throw new AppError("One or more selected documents were not found", 404);
    }

    const accessRoles = await Promise.all(
      documents.map((document) => getDocumentAccessRole(document, userId)),
    );

    if (accessRoles.some((role) => !role)) {
      throw new AppError("One or more selected documents were not found", 404);
    }

    const sharedDocumentIds = documents
      .filter((_document, index) => accessRoles[index] !== "OWNER")
      .map((document) => document._id);
    const shareMap = await getShareMapForDocuments(userId, sharedDocumentIds);
    const foundIds = new Set(documents.map((document) => document._id.toString()));
    const orderedDocumentIds = documentIds.filter((id) => foundIds.has(id));
    const effectiveSubjectIdsByDocument = documents.map((document, index) =>
      accessRoles[index] === "OWNER"
        ? document.subjectId?.toString()
        : getPersonalSubjectId(shareMap.get(document._id.toString())),
    );
    const subjectIds = [
      ...new Set(
        effectiveSubjectIdsByDocument
          .filter((subjectId): subjectId is string => Boolean(subjectId)),
      ),
    ];

    if (
      payload.subjectId &&
      (effectiveSubjectIdsByDocument.some((subjectId) => subjectId !== payload.subjectId))
    ) {
      throw new AppError("Selected documents do not belong to the requested subject", 400);
    }

    if (subjectIds.length > 1) {
      throw new AppError("Selected documents must belong to the same subject", 400);
    }

    const subjectId = payload.subjectId || subjectIds[0];
    const subject = subjectId
      ? (await getSubjectNameForUser(subjectId, userId)) || payload.subject
      : payload.subject;
    const hasProcessingDocument = !(await areAllActiveVersionsReady(documents));

    return {
      scope: "document_set",
      documentIds: orderedDocumentIds,
      subjectId,
      subject,
      hasProcessingDocument,
      isMultiDocumentScope: true,
      vectorFilters: {
        documentIds: orderedDocumentIds,
      },
    };
  }

  if (payload.scope === "subject_all" && !payload.subjectId) {
    throw new AppError("subjectId is required for subject_all scope", 400);
  }

  if (payload.subjectId) {
    const subject = (await getSubjectNameForUser(payload.subjectId, userId)) || payload.subject;
    const sharedDocumentIds = await getSharedDocumentIds(userId, payload.subjectId);
    const documents = await StudyDocument.find({
      $or: [
        { ownerId: userId, subjectId: payload.subjectId },
        { _id: { $in: sharedDocumentIds } },
      ],
      status: { $ne: "DELETED" },
    }).select("_id title subjectId currentVersionId");

    const hasProcessingDocument = documents.length > 0
      ? !(await areAllActiveVersionsReady(documents))
      : false;

    const documentIds = documents.map((doc) => doc._id.toString());

    return {
      scope: "subject_all",
      subjectId: payload.subjectId,
      subject,
      hasProcessingDocument,
      isMultiDocumentScope: true,
      documentIds,
      vectorFilters: {
        documentIds: documentIds.length > 0 ? documentIds : undefined,
        userId: documentIds.length === 0 ? userId : undefined,
        subjectId: documentIds.length === 0 ? payload.subjectId : undefined,
      },
    };
  }

  const canQueryLibraryDocuments = Types.ObjectId.isValid(userId);
  const sharedDocumentIds = canQueryLibraryDocuments
    ? await getSharedDocumentIds(userId)
    : [];
  const accessibleDocuments = canQueryLibraryDocuments
    ? await StudyDocument.find({
        $or: [{ ownerId: userId }, { _id: { $in: sharedDocumentIds } }],
        status: { $ne: "DELETED" },
      }).select("_id currentVersionId")
    : [];
  const accessibleDocumentIds = accessibleDocuments.map((document) =>
    document._id.toString(),
  );

  return {
    scope: "library_all",
    subject: payload.subject,
    hasProcessingDocument: accessibleDocuments.length > 0
      ? !(await areAllActiveVersionsReady(accessibleDocuments))
      : false,
    isMultiDocumentScope: true,
    vectorFilters: {
      documentIds: accessibleDocumentIds.length > 0 ? accessibleDocumentIds : undefined,
      userId: accessibleDocumentIds.length === 0 ? userId : undefined,
      subject: payload.subject,
    },
  };
};

