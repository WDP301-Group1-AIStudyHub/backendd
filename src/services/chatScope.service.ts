import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
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
      ownerId: userId,
      status: { $ne: "DELETED" },
    }).select("_id title subjectId currentVersionId");

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    const subjectId = document.subjectId?.toString();
    const subject = (await getSubjectNameForUser(subjectId, userId)) || payload.subject;
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
        userId,
        documentId: document._id.toString(),
      },
    };
  }

  if (documentIds?.length) {
    const documents = await StudyDocument.find({
      _id: { $in: documentIds },
      ownerId: userId,
      status: { $ne: "DELETED" },
    }).select("_id title subjectId currentVersionId");

    if (documents.length !== documentIds.length) {
      throw new AppError("One or more selected documents were not found", 404);
    }

    const foundIds = new Set(documents.map((document) => document._id.toString()));
    const orderedDocumentIds = documentIds.filter((id) => foundIds.has(id));
    const subjectIds = [
      ...new Set(
        documents
          .map((document) => document.subjectId?.toString())
          .filter((subjectId): subjectId is string => Boolean(subjectId)),
      ),
    ];

    if (payload.subjectId && subjectIds.some((subjectId) => subjectId !== payload.subjectId)) {
      throw new AppError("Selected documents do not belong to the requested subject", 400);
    }

    if (subjectIds.length > 1) {
      throw new AppError("Selected documents must belong to the same subject", 400);
    }

    const subjectId = payload.subjectId || subjectIds[0];
    const subject = (await getSubjectNameForUser(subjectId, userId)) || payload.subject;
    const hasProcessingDocument = !(await areAllActiveVersionsReady(documents));

    return {
      scope: "document_set",
      documentIds: orderedDocumentIds,
      subjectId,
      subject,
      hasProcessingDocument,
      isMultiDocumentScope: true,
      vectorFilters: {
        userId,
        documentIds: orderedDocumentIds,
      },
    };
  }

  if (payload.scope === "subject_all" && !payload.subjectId) {
    throw new AppError("subjectId is required for subject_all scope", 400);
  }

  if (payload.subjectId) {
    const subject = await getSubjectNameForUser(payload.subjectId, userId);
    const documents = await StudyDocument.find({
      subjectId: payload.subjectId,
      ownerId: userId,
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
        userId,
        documentIds: documentIds.length > 0 ? documentIds : undefined,
        subjectId: documentIds.length === 0 ? payload.subjectId : undefined,
      },
    };
  }

  return {
    scope: "library_all",
    subject: payload.subject,
    hasProcessingDocument: false,
    isMultiDocumentScope: true,
    vectorFilters: {
      userId,
      subject: payload.subject,
    },
  };
};

