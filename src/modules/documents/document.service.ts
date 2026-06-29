import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import {
  buildPaginationResponse,
  paginate,
  PaginationResponse,
} from "../../common/utils/pagination.util";
import { ISubject, Subject } from "../subjects/subject.model";
import {
  DocumentStatus,
  DocumentVisibility,
  IDocument,
  StudyDocument,
} from "./document.model";

export interface CreateDocumentRequest {
  title: string;
  description?: string;
  subjectId: string;
  visibility?: DocumentVisibility;
}

export interface UpdateDocumentRequest {
  title?: string;
  description?: string;
  subjectId?: string;
  visibility?: DocumentVisibility;
  status?: Exclude<DocumentStatus, "DELETED">;
}

export interface ListDocumentQuery {
  page?: string;
  limit?: string;
  subjectId?: string;
  keyword?: string;
  visibility?: DocumentVisibility;
  status?: Exclude<DocumentStatus, "DELETED">;
}

export interface SubjectSummaryResponse {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  code?: string;
  semester?: string;
}

export interface DocumentResponse {
  _id: string;
  id: string;
  ownerId: string | Types.ObjectId;
  subjectId: string | Types.ObjectId | SubjectSummaryResponse;
  subject?: SubjectSummaryResponse | null;
  title: string;
  description?: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  totalViews: number;
  totalDownloads: number;
  currentVersionId?: string | Types.ObjectId;
  processingStatus?: string;
  processingStage?: string;
  processingProgress?: number;
  totalVersions: number;
  totalChunks: number;
  lastIndexedAt?: Date | null;
  deletedAt?: Date | null;
  fileUrl?: string;
  filePublicId?: string;
  fileName?: string;
  fileType?: string;
  originalFileName?: string;
  storedFileName?: string;
  fileExtension?: string;
  mimeType?: string;
  fileSize?: number;
  extractedText?: string;
  extractionStatus?: "COMPLETED" | "FAILED";
  extractionError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const toSubjectSummary = (subject: unknown): SubjectSummaryResponse | null => {
  if (!subject || typeof subject !== "object" || !("_id" in subject)) {
    return null;
  }

  const populatedSubject = subject as ISubject;

  return {
    _id: populatedSubject._id.toString(),
    name: populatedSubject.name,
    description: populatedSubject.description,
    color: populatedSubject.color,
    code: populatedSubject.code,
    semester: populatedSubject.semester,
  };
};

export const toDocumentResponse = (document: IDocument): DocumentResponse => {
  const subject = toSubjectSummary(document.subjectId);
  const currentVersion =
    document.currentVersionId &&
    typeof document.currentVersionId === "object" &&
    "processingStatus" in document.currentVersionId
      ? (document.currentVersionId as unknown as {
          processingStatus?: string;
          processingStage?: string;
          processingProgress?: number;
        })
      : undefined;

  return {
    _id: document._id.toString(),
    id: document._id.toString(),
    ownerId: document.ownerId,
    subjectId: subject || document.subjectId,
    subject,
    title: document.title,
    description: document.description,
    visibility: document.visibility,
    status: document.status,
    totalViews: document.totalViews,
    totalDownloads: document.totalDownloads,
    currentVersionId: document.currentVersionId,
    processingStatus: currentVersion?.processingStatus,
    processingStage: currentVersion?.processingStage,
    processingProgress: currentVersion?.processingProgress,
    totalVersions: document.totalVersions,
    totalChunks: document.totalChunks,
    lastIndexedAt: document.lastIndexedAt,
    deletedAt: document.deletedAt,
    fileUrl: document.fileUrl,
    filePublicId: document.filePublicId,
    fileName: document.fileName,
    fileType: document.fileType,
    originalFileName: document.originalFileName || document.fileName,
    storedFileName: document.storedFileName || document.fileName,
    fileExtension: document.fileExtension || "",
    mimeType: document.mimeType || document.fileType,
    fileSize: document.fileSize || 0,
    extractedText: document.extractedText || "",
    extractionStatus: document.extractionStatus || "COMPLETED",
    extractionError: document.extractionError || "",
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSubjectOwnedByUser = async (
  subjectId: string,
  ownerId: string,
): Promise<ISubject> => {
  const subject = await Subject.findOne({ _id: subjectId, ownerId });

  if (!subject) {
    throw new AppError("Subject not found or does not belong to user", 400);
  }

  return subject;
};

const buildReadableDocumentFilter = (
  userId: string,
  role: string,
  query: ListDocumentQuery,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    status: query.status || { $ne: "DELETED" },
  };

  if (role !== "admin") {
    filter.ownerId = userId;
  }

  if (query.subjectId?.trim()) {
    filter.subjectId = query.subjectId.trim();
  }

  if (query.visibility) {
    filter.visibility = query.visibility;
  }

  if (query.keyword?.trim()) {
    const keywordRegex = new RegExp(escapeRegex(query.keyword.trim()), "i");
    filter.$and = [
      {
        $or: [{ title: keywordRegex }, { description: keywordRegex }],
      },
    ];
  }

  return filter;
};

export const createDocumentMetadata = async (
  ownerId: string,
  payload: CreateDocumentRequest,
): Promise<DocumentResponse> => {
  const subject = await getSubjectOwnedByUser(payload.subjectId, ownerId);

  const document = await StudyDocument.create({
    ownerId,
    subjectId: subject._id,
    title: payload.title,
    description: payload.description,
    visibility: payload.visibility || "PRIVATE",
    status: "ACTIVE",
  });

  await document.populate("subjectId", "_id name description color code semester");

  return toDocumentResponse(document);
};

export const getDocuments = async (
  userId: string,
  role: string = "user",
  query: ListDocumentQuery = {},
): Promise<{ data: DocumentResponse[]; pagination: PaginationResponse }> => {
  const { page, limit, skip } = paginate(query);
  const filters = buildReadableDocumentFilter(userId, role, query);

  const [documents, totalItems] = await Promise.all([
    StudyDocument.find(filters)
      .select("-extractedText")
      .populate("subjectId", "_id name description color code semester")
      .populate(
        "currentVersionId",
        "_id processingStatus processingStage processingProgress",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    StudyDocument.countDocuments(filters),
  ]);

  return {
    data: documents.map(toDocumentResponse),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const getDocumentDetail = async (
  documentId: string,
  userId: string,
  role: string = "user",
): Promise<DocumentResponse> => {
  const filter: Record<string, any> = {
    _id: documentId,
    status: { $ne: "DELETED" },
  };

  if (role !== "admin") {
    filter.ownerId = userId;
  }

  const document = await StudyDocument.findOne(filter).populate(
    "subjectId",
    "_id name description color code semester",
  );
  await document?.populate(
    "currentVersionId",
    "_id processingStatus processingStage processingProgress",
  );

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return toDocumentResponse(document);
};

export const updateDocumentMetadata = async (
  documentId: string,
  ownerId: string,
  role: string,
  payload: UpdateDocumentRequest,
): Promise<DocumentResponse> => {
  const filter: Record<string, any> = {
    _id: documentId,
    status: { $ne: "DELETED" },
  };

  if (role !== "admin") {
    filter.ownerId = ownerId;
  }

  const existingDocument = await StudyDocument.findOne(filter);

  if (!existingDocument) {
    throw new AppError("Document not found", 404);
  }

  if (payload.subjectId !== undefined && payload.subjectId !== null && payload.subjectId !== "") {
    const subjectOwnerId = role === "admin" ? existingDocument.ownerId.toString() : ownerId;
    await getSubjectOwnedByUser(payload.subjectId, subjectOwnerId);
  }

  const document = await StudyDocument.findOneAndUpdate(
    filter,
    payload,
    {
      new: true,
      runValidators: true,
    },
  ).populate("subjectId", "_id name description color code semester");

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return toDocumentResponse(document);
};

export const softDeleteDocument = async (
  documentId: string,
  ownerId: string,
  role: string = "user",
): Promise<void> => {
  const filter: Record<string, any> = {
    _id: documentId,
    status: { $ne: "DELETED" },
  };

  if (role !== "admin") {
    filter.ownerId = ownerId;
  }

  const document = await StudyDocument.findOneAndUpdate(
    filter,
    {
      status: "DELETED",
      deletedAt: new Date(),
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!document) {
    throw new AppError("Document not found", 404);
  }
};
