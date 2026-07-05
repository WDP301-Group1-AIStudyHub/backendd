import { StudyDocument, IDocument } from "../models/document.model";
import { ISubject, Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import {
  DocumentListResponse,
  DocumentListItemResponse,
  DocumentResponse,
  DebugDocumentChunkResponse,
  ListDocumentQuery,
  PaginatedDocumentListResponse,
  ReindexDocumentResponse,
  SearchDocumentQuery,
  UpdateDocumentRequest,
  UploadDocumentRequest,
} from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import { uploadDocumentToCloudinary } from "./cloudinary.service";
import { extractDocumentText } from "./documentExtraction/extractDocumentText";
import {
  indexDocumentForRag,
  reembedDocumentForRag,
  reindexDocumentForRag,
} from "./rag.service";
import { getFileExtension } from "../utils/fileName";
import { splitTextForRag } from "../utils/textSplitter";
import { analyzeDocumentStructure } from "../utils/documentStructure";
import {
  extractDocumentOutline,
  summarizeDocumentOutline,
  type DocumentOutlineNode,
} from "../utils/documentOutline";

const MAX_DOCUMENT_LIST_LIMIT = 50;
const DEFAULT_DOCUMENT_LIST_LIMIT = 10;
const DEFAULT_DOCUMENT_LIST_PAGE = 1;
const DOCUMENT_LIST_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "title",
  "subjectId",
  "fileName",
  "fileSize",
]);

const toSubjectSummary = (subject: unknown) => {
  if (!subject || typeof subject !== "object" || !("_id" in subject)) {
    return undefined;
  }

  const populatedSubject = subject as ISubject;

  return {
    _id: populatedSubject._id.toString(),
    name: populatedSubject.name,
    color: populatedSubject.color,
    code: populatedSubject.code,
    semester: populatedSubject.semester,
  };
};

export const toDocumentResponse = (document: IDocument): DocumentResponse => {
  const subjectSummary = toSubjectSummary(document.subjectId);

  return {
    id: document._id.toString(),
    title: document.title,
    description: document.description,
    subject: subjectSummary?.name,
    subjectId: subjectSummary || document.subjectId,
    fileUrl: document.fileUrl,
    filePublicId: document.filePublicId,
    fileName: document.fileName,
    fileType: document.fileType,
    originalFileName: document.originalFileName || document.fileName,
    storedFileName: document.storedFileName || document.fileName,
    fileExtension:
      document.fileExtension || getFileExtension(document.fileName || ""),
    mimeType: document.mimeType || document.fileType,
    fileSize: document.fileSize,
    extractedText: document.extractedText,
    extractionStatus: document.extractionStatus || "COMPLETED",
    extractionError: document.extractionError || "",
    totalChunks: document.totalChunks || 0,
    chunkingStrategy: document.chunkingStrategy,
    detectedSections: document.detectedSections || [],
    documentOutline: document.documentOutline || [],
    chapterCount: document.chapterCount || 0,
    partCount: document.partCount || 0,
    sectionCount: document.sectionCount || 0,
    uploadedBy: document.ownerId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value || "", 10);

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
};

const toDocumentListItemResponse = (
  document: IDocument,
): DocumentListItemResponse => ({
  _id: document._id.toString(),
  title: document.title,
  description: document.description,
  subject: toSubjectSummary(document.subjectId) || null,
  fileUrl: document.fileUrl,
  fileName: document.fileName,
  fileType: document.fileType,
  fileSize: document.fileSize,
  totalChunks: document.totalChunks || 0,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

const getSubjectOwnedByUser = async (
  subjectId: string,
  userId: string,
): Promise<ISubject> => {
  const subject = await Subject.findOne({ _id: subjectId, ownerId: userId });

  if (!subject) {
    throw new AppError("Subject not found or does not belong to user", 400);
  }

  return subject;
};

export const createDocument = async (
  payload: UploadDocumentRequest,
  file: Express.Multer.File | undefined,
  userId: string,
): Promise<DocumentResponse> => {
  if (!file) {
    throw new AppError("Document file is required", 400);
  }

  const subject = await getSubjectOwnedByUser(payload.subjectId, userId);

  let extractedText = "";
  let extractionStatus: "COMPLETED" | "FAILED" = "COMPLETED";
  let extractionError = "";
  let semanticOutline: DocumentOutlineNode[] = [];

  try {
    const extractionResult = await extractDocumentText(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    extractedText = extractionResult.extractedText;
    semanticOutline = extractionResult.metadata?.semanticOutline || [];
  } catch (error) {
    extractionStatus = "FAILED";
    extractionError = error instanceof Error ? error.message : String(error);
  }

  const cloudinaryUpload = await uploadDocumentToCloudinary(file);
  const chunkingResult = await splitTextForRag(extractedText);
  const documentOutline = extractDocumentOutline({
    text: extractedText,
    chunkingResult,
    semanticOutline,
  });
  const outlineSummary = summarizeDocumentOutline(documentOutline);
  const structure = analyzeDocumentStructure(chunkingResult);

  const document = await StudyDocument.create({
    title: payload.title,
    description: payload.description,
    subjectId: subject._id,
    fileUrl: cloudinaryUpload.result.secure_url,
    filePublicId: cloudinaryUpload.result.public_id,
    fileName: file.originalname,
    fileType: file.mimetype,
    originalFileName: cloudinaryUpload.originalFileName,
    storedFileName: cloudinaryUpload.storedFileName,
    fileExtension: cloudinaryUpload.fileExtension,
    mimeType: cloudinaryUpload.mimeType,
    fileSize: file.size,
    extractedText,
    extractionStatus,
    extractionError,
    visibility: payload.visibility || "PRIVATE",
    status: "ACTIVE",
    ownerId: userId,
    chunkingStrategy: structure.chunkingStrategy,
    detectedSections:
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections,
    documentOutline,
    chapterCount: Math.max(outlineSummary.chapterCount, structure.chapterCount),
    partCount: outlineSummary.partCount || structure.partCount,
    sectionCount: outlineSummary.sectionCount || structure.sectionCount,
  });
  const version = await DocumentVersion.create({
    documentId: document._id,
    versionNumber: 1,
    uploadMode: "OVERRIDE",
    fileUrl: cloudinaryUpload.result.secure_url,
    filePublicId: cloudinaryUpload.result.public_id,
    fileName: file.originalname,
    originalFileName: cloudinaryUpload.originalFileName,
    storedFileName: cloudinaryUpload.storedFileName,
    fileType: file.mimetype,
    mimeType: cloudinaryUpload.mimeType,
    fileSize: file.size,
    fileExtension: cloudinaryUpload.fileExtension,
    extractedText,
    extractionStatus,
    extractionError,
    processingStatus: extractionStatus === "COMPLETED" ? "PENDING" : "FAILED",
    processingStage: extractionStatus === "COMPLETED" ? "UPLOADED" : "FAILED",
    processingProgress: extractionStatus === "COMPLETED" ? 0 : 100,
    processingError: extractionStatus === "COMPLETED" ? "" : extractionError,
    totalChunks: chunkingResult.chunks.length,
    chunkingStrategy: structure.chunkingStrategy,
    detectedSections:
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections,
    documentOutline,
    chapterCount: Math.max(outlineSummary.chapterCount, structure.chapterCount),
    partCount: outlineSummary.partCount || structure.partCount,
    sectionCount: outlineSummary.sectionCount || structure.sectionCount,
    uploadedBy: document.ownerId,
    isActive: true,
  });

  document.currentVersionId = version._id;
  document.totalVersions = 1;
  document.totalChunks = version.totalChunks;
  await document.save();

  if (extractionStatus === "COMPLETED") {
    const indexResult = await indexDocumentForRag(document._id.toString(), userId);
    const indexedAt = new Date();

    version.indexedAt = indexedAt;
    version.totalChunks = indexResult.chunksCreated;
    version.chunkingStrategy = indexResult.chunkingStrategy;
    version.detectedSections = indexResult.detectedSections;
    version.documentOutline = indexResult.documentOutline || [];
    version.chapterCount = indexResult.chapterCount || 0;
    version.partCount = indexResult.partCount || 0;
    version.sectionCount = indexResult.sectionCount || 0;
    version.processingStatus = "INDEXED";
    version.processingStage = "COMPLETED";
    version.processingProgress = 100;
    version.processingError = "";
    version.processingCompletedAt = indexedAt;
    await version.save();
    document.lastIndexedAt = indexedAt;
    document.totalChunks = indexResult.chunksCreated;
    document.chunkingStrategy = indexResult.chunkingStrategy;
    document.detectedSections = indexResult.detectedSections;
    document.documentOutline = indexResult.documentOutline || [];
    document.chapterCount = indexResult.chapterCount || 0;
    document.partCount = indexResult.partCount || 0;
    document.sectionCount = indexResult.sectionCount || 0;
    await document.save();
  }

  return toDocumentResponse(document);
};

export const getDocumentsByUser = async (
  userId: string,
  query: ListDocumentQuery = {},
): Promise<PaginatedDocumentListResponse> => {
  const page = parsePositiveInteger(query.page, DEFAULT_DOCUMENT_LIST_PAGE);
  const parsedLimit = parsePositiveInteger(
    query.limit,
    DEFAULT_DOCUMENT_LIST_LIMIT,
  );
  const limit = Math.min(parsedLimit, MAX_DOCUMENT_LIST_LIMIT);
  const skip = (page - 1) * limit;
  const sortBy = DOCUMENT_LIST_SORT_FIELDS.has(query.sortBy || "")
    ? query.sortBy!
    : "createdAt";
  const sortOrder = query.sortOrder === "asc" ? 1 : -1;
  const filters: Record<string, unknown> = {
    ownerId: userId,
    status: { $ne: "DELETED" },
  };

  if (query.subjectId?.trim()) {
    filters.subjectId = query.subjectId.trim();
  }

  if (query.search?.trim()) {
    const searchRegex = new RegExp(escapeRegex(query.search.trim()), "i");
    filters.$or = [{ title: searchRegex }, { description: searchRegex }];
  }

  const [documents, totalItems] = await Promise.all([
    StudyDocument.find(filters)
      .select("-extractedText")
      .populate("subjectId", "_id name color code semester")
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit),
    StudyDocument.countDocuments(filters),
  ]);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    items: documents.map(toDocumentListItemResponse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

export const getDocumentSubjectsByUser = async (
  userId: string,
): Promise<string[]> => {
  const subjectIds = await StudyDocument.distinct("subjectId", {
    ownerId: userId,
    subjectId: { $nin: [null, ""] },
    status: { $ne: "DELETED" },
  });
  const subjects = await Subject.find({
    _id: { $in: subjectIds },
    ownerId: userId,
  }).select("name");

  return subjects
    .map((subject) => subject.name.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
};

export const getDocumentById = async (
  documentId: string,
  userId: string,
): Promise<DocumentResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  }).populate("subjectId", "_id name color code semester");

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return toDocumentResponse(document);
};

export const reindexUserDocument = async (
  documentId: string,
  userId: string,
): Promise<ReindexDocumentResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const result = await reembedDocumentForRag(document._id.toString(), userId);
  const indexedAt = new Date();

  await StudyDocument.updateOne(
    { _id: document._id, ownerId: userId },
    {
      $set: {
        totalChunks: result.chunksCreated,
        chunkingStrategy: result.chunkingStrategy,
        detectedSections: result.detectedSections,
        documentOutline: result.documentOutline || [],
        chapterCount: result.chapterCount || 0,
        partCount: result.partCount || 0,
        sectionCount: result.sectionCount || 0,
        lastIndexedAt: indexedAt,
      },
    },
  );

  if (document.currentVersionId) {
    await DocumentVersion.updateOne(
      {
        _id: document.currentVersionId,
        documentId: document._id,
        isActive: true,
        deletedAt: null,
      },
      {
        $set: {
          totalChunks: result.chunksCreated,
          chunkingStrategy: result.chunkingStrategy,
          detectedSections: result.detectedSections,
          documentOutline: result.documentOutline || [],
          chapterCount: result.chapterCount || 0,
          partCount: result.partCount || 0,
          sectionCount: result.sectionCount || 0,
          indexedAt,
          processingStatus: "INDEXED",
          processingStage: "COMPLETED",
          processingProgress: 100,
          processingError: "",
          processingCompletedAt: indexedAt,
        },
      },
    );
  }

  console.log("[RAG reindex] Reindex endpoint completed", result);

  return result;
};

export const getDebugDocumentChunks = async (
  documentId: string,
  userId: string,
): Promise<DebugDocumentChunkResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  const chunkingResult = await splitTextForRag(document.extractedText || "");

  return {
    chunksCount: chunkingResult.chunks.length,
    chunkingStrategy: chunkingResult.chunkingStrategy,
    chunks: chunkingResult.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      sectionIndex: chunk.metadata.sectionIndex,
      heading: chunk.metadata.heading,
      sectionTitle: chunk.metadata.sectionTitle,
      contentLength: chunk.metadata.contentLength,
      contentPreview:
        chunk.content.length > 220
          ? `${chunk.content.slice(0, 220)}...`
          : chunk.content,
    })),
  };
};

export const updateDocument = async (
  documentId: string,
  userId: string,
  payload: UpdateDocumentRequest,
): Promise<DocumentResponse> => {
  const updatePayload: UpdateDocumentRequest = { ...payload };

  if (payload.subjectId !== undefined) {
    const subject = await getSubjectOwnedByUser(payload.subjectId, userId);
    updatePayload.subjectId = subject._id.toString();
  }

  const document = await StudyDocument.findOneAndUpdate(
    { _id: documentId, ownerId: userId, status: { $ne: "DELETED" } },
    updatePayload,
    {
      new: true,
      runValidators: true,
    },
  ).populate("subjectId", "_id name color code semester");

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  if (payload.subjectId !== undefined) {
    await reindexDocumentForRag(document._id.toString(), userId);
  }

  return toDocumentResponse(document);
};

export const deleteDocument = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  const document = await StudyDocument.findOneAndUpdate(
    {
      _id: documentId,
      ownerId: userId,
      status: { $ne: "DELETED" },
    },
    {
      status: "DELETED",
      deletedAt: new Date(),
      deletedBy: userId,
    },
  );

  if (!document) {
    throw new AppError("Document not found", 404);
  }

};

export const searchDocuments = async (
  userId: string,
  query: SearchDocumentQuery,
): Promise<DocumentListResponse> => {
  const filters: Record<string, unknown> = {
    ownerId: userId,
    status: { $ne: "DELETED" },
  };

  if (query.subjectId) {
    filters.subjectId = query.subjectId;
  }

  if (query.keyword) {
    filters.$text = { $search: query.keyword };
  }

  const documents = await StudyDocument.find(filters)
    .populate("subjectId", "_id name color code semester")
    .sort({ createdAt: -1 });

  return {
    documents: documents.map(toDocumentResponse),
    total: documents.length,
  };
};
