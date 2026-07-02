import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import {
  buildPaginationResponse,
  paginate,
  PaginationResponse,
} from "../../common/utils/pagination.util";
import { ISubject, Subject } from "../subjects/subject.model";
import { DocumentShare, IDocumentShare } from "../documentShares/documentShare.model";
import {
  assertRoleHasAccess,
  DocumentAccessRole,
  getDocumentAccessRole,
  permissionToAccessRole,
} from "../documentShares/documentShare.service";
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
  subjectId?: string | Types.ObjectId | SubjectSummaryResponse;
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
  accessRole?: DocumentAccessRole;
  isShared?: boolean;
  sharedBy?: {
    id: string;
    fullName: string;
    email: string;
  };
  personalSubjectId?: string | Types.ObjectId | SubjectSummaryResponse;
  personalSubject?: SubjectSummaryResponse | null;
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

interface DocumentResponseOptions {
  accessRole?: DocumentAccessRole;
  isShared?: boolean;
  sharedBy?: {
    id: string;
    fullName: string;
    email: string;
  };
  subjectOverride?: SubjectSummaryResponse | null;
  personalSubject?: SubjectSummaryResponse | null;
}

export const toDocumentResponse = (
  document: IDocument,
  options: DocumentResponseOptions = {},
): DocumentResponse => {
  const ownerSubject = toSubjectSummary(document.subjectId);
  const hasSubjectOverride = Object.prototype.hasOwnProperty.call(
    options,
    "subjectOverride",
  );
  const subject = hasSubjectOverride
    ? options.subjectOverride ?? null
    : ownerSubject;
  const personalSubject = options.personalSubject !== undefined
    ? options.personalSubject
    : hasSubjectOverride
      ? subject
      : undefined;
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
    subjectId: hasSubjectOverride
      ? subject?._id
      : subject || document.subjectId,
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
    accessRole: options.accessRole,
    isShared: options.isShared,
    sharedBy: options.sharedBy,
    personalSubjectId: personalSubject?._id,
    personalSubject,
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
  sharedDocumentIds: string[] = [],
): Record<string, unknown> => {
  const subjectId = query.subjectId?.trim();
  const filter: Record<string, unknown> = {
    status: query.status || { $ne: "DELETED" },
  };

  if (role !== "admin") {
    filter.$or = subjectId
      ? [
          { ownerId: userId, subjectId },
          { _id: { $in: sharedDocumentIds } },
        ]
      : [
          { ownerId: userId },
          { _id: { $in: sharedDocumentIds } },
        ];
  }

  if (role === "admin" && subjectId) {
    filter.subjectId = subjectId;
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

interface DocumentAccessContext {
  accessRole: DocumentAccessRole;
  personalSubject?: SubjectSummaryResponse | null;
}

const toPersonalSubjectSummary = (
  share: Pick<IDocumentShare, "personalSubjectId">,
): SubjectSummaryResponse | null =>
  toSubjectSummary(share.personalSubjectId);

const toSharedBySummary = (
  value: unknown,
): DocumentResponseOptions["sharedBy"] | undefined => {
  if (!value || typeof value !== "object" || !("_id" in value)) {
    return undefined;
  }

  const user = value as {
    _id: Types.ObjectId;
    fullName?: string;
    email?: string;
  };

  return {
    id: user._id.toString(),
    fullName: user.fullName || "",
    email: user.email || "",
  };
};

const buildAccessContextMap = async (
  documents: IDocument[],
  userId: string,
  role: string,
): Promise<Map<string, DocumentAccessContext>> => {
  const accessMap = new Map<string, DocumentAccessContext>();

  for (const document of documents) {
    if (role === "admin" || document.ownerId.toString() === userId) {
      accessMap.set(document._id.toString(), { accessRole: "OWNER" });
    }
  }

  const sharedDocumentIds = documents
    .filter((document) => !accessMap.has(document._id.toString()))
    .map((document) => document._id);

  if (sharedDocumentIds.length === 0) {
    return accessMap;
  }

  const shares = await DocumentShare.find({
    documentId: { $in: sharedDocumentIds },
    sharedWithUserId: userId,
  })
    .select("documentId permission personalSubjectId")
    .populate("personalSubjectId", "_id name description color code semester");

  for (const share of shares) {
    accessMap.set(
      share.documentId.toString(),
      {
        accessRole: permissionToAccessRole(share.permission),
        personalSubject: toPersonalSubjectSummary(share),
      },
    );
  }

  return accessMap;
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
  const requestedSubjectId = query.subjectId?.trim();
  const sharedDocumentIds =
    role === "admin"
      ? []
      : (await DocumentShare.distinct("documentId", {
          sharedWithUserId: userId,
          ...(requestedSubjectId ? { personalSubjectId: requestedSubjectId } : {}),
        })).map((id) => id.toString());
  const filters = buildReadableDocumentFilter(userId, role, query, sharedDocumentIds);

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
  const accessMap = await buildAccessContextMap(documents, userId, role);

  return {
    data: documents.map((document) => {
      const accessContext = accessMap.get(document._id.toString());
      const isShared =
        accessContext?.accessRole !== "OWNER" && document.ownerId.toString() !== userId;
      const responseOptions: DocumentResponseOptions = {
        accessRole: accessContext?.accessRole,
        isShared,
      };

      if (isShared) {
        responseOptions.subjectOverride = accessContext?.personalSubject ?? null;
        responseOptions.personalSubject = accessContext?.personalSubject ?? null;
      }

      return toDocumentResponse(document, responseOptions);
    }),
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

  const accessRole = await getDocumentAccessRole(document, userId, role);

  if (!accessRole) {
    throw new AppError("Document not found", 404);
  }

  const isShared =
    accessRole !== "OWNER" && document.ownerId.toString() !== userId;
  const share = isShared
    ? await DocumentShare.findOne({
        documentId,
        sharedWithUserId: userId,
      })
        .populate("personalSubjectId", "_id name description color code semester")
        .populate("sharedBy", "_id fullName email")
    : null;
  const responseOptions: DocumentResponseOptions = {
    accessRole,
    isShared,
  };

  if (isShared) {
    const personalSubject = share ? toPersonalSubjectSummary(share) : null;
    responseOptions.subjectOverride = personalSubject;
    responseOptions.personalSubject = personalSubject;
    responseOptions.sharedBy = toSharedBySummary(share?.sharedBy);
  }

  return toDocumentResponse(document, responseOptions);
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

  const existingDocument = await StudyDocument.findOne(filter);

  if (!existingDocument) {
    throw new AppError("Document not found", 404);
  }

  const accessRole = await getDocumentAccessRole(existingDocument, ownerId, role);

  if (!accessRole) {
    throw new AppError("Document not found", 404);
  }

  assertRoleHasAccess(accessRole, "EDIT");

  const hasOwnerOnlyMetadataChange =
    (payload.subjectId !== undefined && payload.subjectId !== null && payload.subjectId !== "") ||
    payload.visibility !== undefined ||
    payload.status !== undefined;

  if (accessRole !== "OWNER" && hasOwnerOnlyMetadataChange) {
    throw new AppError(
      "Only the document owner can update document organization and visibility",
      403,
    );
  }

  if (payload.subjectId !== undefined && payload.subjectId !== null && payload.subjectId !== "") {
    const subjectOwnerId = existingDocument.ownerId.toString();
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

  return toDocumentResponse(document, {
    accessRole,
    isShared: document.ownerId.toString() !== ownerId,
  });
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

  const existingDocument = await StudyDocument.findOne(filter);

  if (!existingDocument) {
    throw new AppError("Document not found", 404);
  }

  const accessRole = await getDocumentAccessRole(existingDocument, ownerId, role);

  if (!accessRole) {
    throw new AppError("Document not found", 404);
  }

  assertRoleHasAccess(accessRole, "OWNER");

  const document = await StudyDocument.findOneAndUpdate(
    { _id: documentId, status: { $ne: "DELETED" } },
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

export const getDocumentDownloadUrl = async (
  documentId: string,
  userId: string,
  role: string = "user",
): Promise<{ downloadUrl: string; fileName?: string }> => {
  const data = await getDocumentDetail(documentId, userId, role);

  if (!data.fileUrl) {
    throw new AppError("Document file not found", 404);
  }

  return {
    downloadUrl: data.fileUrl,
    fileName: data.fileName,
  };
};

export const getSharedDocumentsWithUser = async (
  userId: string,
  query: ListDocumentQuery = {},
): Promise<{ data: DocumentResponse[]; pagination: PaginationResponse }> => {
  const { page, limit, skip } = paginate(query);
  const requestedSubjectId = query.subjectId?.trim();
  const shares = await DocumentShare.find({
    sharedWithUserId: userId,
    ...(requestedSubjectId ? { personalSubjectId: requestedSubjectId } : {}),
  })
    .populate({
      path: "documentId",
      match: { status: { $ne: "DELETED" } },
      populate: [
        {
          path: "subjectId",
          select: "_id name description color code semester",
        },
        {
          path: "currentVersionId",
          select: "_id processingStatus processingStage processingProgress",
        },
      ],
    })
    .populate("personalSubjectId", "_id name description color code semester")
    .populate("sharedBy", "_id fullName email")
    .sort({ createdAt: -1 });

  const keyword = query.keyword?.trim().toLowerCase();
  const activeShares = shares
    .filter((share) => Boolean(share.documentId))
    .filter((share) => {
      if (!keyword) {
        return true;
      }

      const document = share.documentId as unknown as IDocument;
      const personalSubject = toPersonalSubjectSummary(share);
      const sharedBy = toSharedBySummary(share.sharedBy);
      const searchable = [
        document.title,
        document.description,
        document.fileName,
        personalSubject?.name,
        personalSubject?.code,
        sharedBy?.fullName,
        sharedBy?.email,
      ];

      return searchable
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  const totalItems = activeShares.length;
  const pageItems = activeShares.slice(skip, skip + limit);

  return {
    data: pageItems.map((share) => {
      const sharedBy = share.sharedBy as unknown as {
        _id: Types.ObjectId;
        fullName: string;
        email: string;
      };
      const personalSubject = toPersonalSubjectSummary(share);

      return toDocumentResponse(share.documentId as unknown as IDocument, {
        accessRole: permissionToAccessRole(share.permission),
        isShared: true,
        subjectOverride: personalSubject,
        personalSubject,
        sharedBy: {
          id: sharedBy._id.toString(),
          fullName: sharedBy.fullName,
          email: sharedBy.email,
        },
      });
    }),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const updateSharedDocumentProfile = async (
  documentId: string,
  userId: string,
  payload: { subjectId?: string | null },
): Promise<DocumentResponse> => {
  const [document, share] = await Promise.all([
    StudyDocument.findOne({
      _id: documentId,
      status: { $ne: "DELETED" },
    }).populate(
      "currentVersionId",
      "_id processingStatus processingStage processingProgress",
    ),
    DocumentShare.findOne({
      documentId,
      sharedWithUserId: userId,
    })
      .populate("personalSubjectId", "_id name description color code semester")
      .populate("sharedBy", "_id fullName email"),
  ]);

  if (!document || !share) {
    throw new AppError("Document not found", 404);
  }

  const nextSubjectId = payload.subjectId?.trim();

  if (nextSubjectId) {
    const subject = await getSubjectOwnedByUser(nextSubjectId, userId);
    share.personalSubjectId = subject._id;
  } else {
    share.personalSubjectId = null;
  }

  await share.save();
  await share.populate("personalSubjectId", "_id name description color code semester");

  const personalSubject = toPersonalSubjectSummary(share);

  return toDocumentResponse(document, {
    accessRole: permissionToAccessRole(share.permission),
    isShared: true,
    subjectOverride: personalSubject,
    personalSubject,
    sharedBy: toSharedBySummary(share.sharedBy),
  });
};
