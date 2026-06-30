import { Types } from "mongoose";
import {
  buildPaginationResponse,
  paginate,
  PaginationResponse,
} from "../../common/utils/pagination.util";
import { AppError } from "../../middlewares/error.middleware";
import { uploadDocumentToCloudinary } from "../../services/cloudinary.service";
import { extractDocumentText } from "../../services/documentExtraction/extractDocumentText";
import { reindexDocumentForRag } from "../../services/rag.service";
import { emitUploadProgress } from "../../services/uploadProgress.socket";
import {
  deleteDocumentChunks,
  upsertDocumentChunks,
} from "../../services/vector.service";
import { Subject } from "../subjects/subject.model";
import { UploadSession } from "../uploadSessions/uploadSession.model";
import { splitTextForRag } from "../../utils/textSplitter";
import { analyzeDocumentStructure } from "../../utils/documentStructure";
import {
  applyOutlineToChunks,
  extractDocumentOutline,
  summarizeDocumentOutline,
} from "../../utils/documentOutline";
import { StudyDocument, IDocument } from "../documents/document.model";
import { DocumentVersion, IDocumentVersion } from "./documentVersion.model";
import {
  DocumentVersionResponse,
  DocumentVersionUploadMode,
  UploadDocumentVersionRequest,
} from "./documentVersion.types";
import type { DocumentOutlineNode } from "../../utils/documentOutline";

interface ListDocumentVersionsQuery {
  page?: string;
  limit?: string;
}

interface GetDocumentVersionDetailQuery {
  includeText?: string | boolean;
}

interface VersioningDependencies {
  uploadFile: typeof uploadDocumentToCloudinary;
  reindexDocument: typeof reindexDocumentForRag;
  extractText: typeof extractDocumentText;
  chunkText: typeof splitTextForRag;
  upsertChunks: typeof upsertDocumentChunks;
  deleteChunks: typeof deleteDocumentChunks;
  emitProgress: typeof emitUploadProgress;
}

interface VersioningOptions {
  skipReindex?: boolean;
  dependencies?: Partial<VersioningDependencies>;
}

const defaultDependencies: VersioningDependencies = {
  uploadFile: uploadDocumentToCloudinary,
  reindexDocument: reindexDocumentForRag,
  extractText: extractDocumentText,
  chunkText: splitTextForRag,
  upsertChunks: upsertDocumentChunks,
  deleteChunks: deleteDocumentChunks,
  emitProgress: emitUploadProgress,
};

const getDependencies = (
  options: VersioningOptions = {},
): VersioningDependencies => ({
  ...defaultDependencies,
  ...options.dependencies,
});

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return fallback;
};

const getReadableDocument = async (
  documentId: string,
  userId: string,
): Promise<{ document: IDocument; isOwner: boolean }> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    status: { $ne: "DELETED" },
    $or: [{ ownerId: userId }, { visibility: "PUBLIC" }],
  });

  if (!document) {
    throw new AppError("DOCUMENT_NOT_FOUND", 404);
  }

  return {
    document,
    isOwner: document.ownerId.toString() === userId,
  };
};

const getOwnedDocumentForVersionWrite = async (
  documentId: string,
  userId: string,
): Promise<IDocument> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("DOCUMENT_NOT_FOUND", 404);
  }

  return document;
};

const toVersionResponse = (
  version: IDocumentVersion,
  includeText = false,
): DocumentVersionResponse => ({
  id: version._id.toString(),
  documentId: version.documentId,
  versionNumber: version.versionNumber,
  uploadMode: version.uploadMode,
  fileName: version.fileName,
  fileUrl: version.fileUrl,
  fileType: version.fileType,
  fileSize: version.fileSize,
  fileExtension: version.fileExtension,
  extractionStatus: version.extractionStatus,
  extractionError: version.extractionError,
  processingStatus: version.processingStatus,
  processingStage: version.processingStage,
  processingProgress: version.processingProgress,
  processingError: version.processingError,
  processingStartedAt: version.processingStartedAt,
  processingCompletedAt: version.processingCompletedAt,
  uploadSessionId: version.uploadSessionId?.toString(),
  totalChunks: version.totalChunks,
  chunkingStrategy: version.chunkingStrategy,
  detectedSections: version.detectedSections || [],
  documentOutline: version.documentOutline || [],
  chapterCount: version.chapterCount || 0,
  partCount: version.partCount || 0,
  sectionCount: version.sectionCount || 0,
  indexedAt: version.indexedAt,
  isActive: version.isActive,
  uploadedBy: version.uploadedBy,
  uploadReason: version.uploadReason,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
  ...(includeText ? { extractedText: version.extractedText } : {}),
});

const updateDocumentFromActiveVersion = async (
  documentId: string,
  version: IDocumentVersion,
): Promise<void> => {
  await StudyDocument.updateOne(
    { _id: documentId },
    {
      $set: {
        currentVersionId: version._id,
        totalChunks: version.totalChunks,
        chunkingStrategy: version.chunkingStrategy,
        detectedSections: version.detectedSections || [],
        documentOutline: version.documentOutline || [],
        chapterCount: version.chapterCount || 0,
        partCount: version.partCount || 0,
        sectionCount: version.sectionCount || 0,
        lastIndexedAt: version.indexedAt,
        fileUrl: version.fileUrl,
        filePublicId: version.filePublicId,
        fileName: version.fileName,
        fileType: version.fileType,
        originalFileName: version.originalFileName,
        storedFileName: version.storedFileName,
        fileExtension: version.fileExtension,
        mimeType: version.mimeType,
        fileSize: version.fileSize,
        extractedText: version.extractedText,
        extractionStatus:
          version.extractionStatus === "FAILED" ? "FAILED" : "COMPLETED",
        extractionError: version.extractionError || "",
      },
    },
  );
};

const maybeReindexActiveVersion = async (
  documentId: string,
  ownerId: string,
  options: VersioningOptions,
): Promise<{
  indexedAt: Date;
  chunksCreated: number;
  chunkingStrategy?: "heading-based" | "fixed-size-fallback";
  detectedSections: string[];
  documentOutline?: DocumentOutlineNode[];
  chapterCount: number;
  partCount: number;
  sectionCount: number;
} | null> => {
  if (options.skipReindex) {
    return null;
  }

  // Phase 5 keeps the existing document-level indexing pipeline stable. It
  // reindexes the active version by first syncing active version text to
  // Document.extractedText. Phase 6/8 can move Pinecone vectors to strict
  // versionId-based IDs and metadata.
  const result = await getDependencies(options).reindexDocument(documentId, ownerId);

  return {
    indexedAt: new Date(),
    chunksCreated: result.chunksCreated,
    chunkingStrategy: result.chunkingStrategy,
    detectedSections: result.detectedSections,
    documentOutline: result.documentOutline || [],
    chapterCount: result.chapterCount || 0,
    partCount: result.partCount || 0,
    sectionCount: result.sectionCount || 0,
  };
};

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Document processing failed";

const uploadEventByStage: Record<string, string> = {
  UPLOADED: "upload:started",
  EXTRACTING_TEXT: "upload:extracting_text",
  CHUNKING: "upload:chunking",
  EMBEDDING: "upload:embedding",
  UPSERTING_VECTOR: "upload:indexing",
  COMPLETED: "upload:completed",
  FAILED: "upload:failed",
};

const updateProcessingProgress = async (
  documentId: string,
  version: IDocumentVersion,
  uploadSessionId: string,
  dependencies: VersioningDependencies,
  status: "PROCESSING" | "INDEXED" | "FAILED",
  stage:
    | "UPLOADED"
    | "EXTRACTING_TEXT"
    | "CHUNKING"
    | "EMBEDDING"
    | "UPSERTING_VECTOR"
    | "COMPLETED"
    | "FAILED",
  progress: number,
  message: string,
  errorMessage = "",
): Promise<void> => {
  const completedAt = status === "INDEXED" || status === "FAILED" ? new Date() : null;
  const sessionStatus =
    status === "INDEXED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "PROCESSING";

  version.processingStatus = status;
  version.processingStage = stage;
  version.processingProgress = progress;
  version.processingError = errorMessage;
  if (status === "PROCESSING" && !version.processingStartedAt) {
    version.processingStartedAt = new Date();
  }
  if (completedAt) {
    version.processingCompletedAt = completedAt;
  }
  await version.save();

  await UploadSession.updateOne(
    { _id: uploadSessionId },
    {
      $set: {
        status: sessionStatus,
        stage,
        progress,
        message,
        errorMessage,
        ...(completedAt ? { completedAt } : {}),
      },
    },
  );

  dependencies.emitProgress(uploadEventByStage[stage] || "upload:processing", {
    documentId,
    uploadSessionId,
    versionId: version._id.toString(),
    status: status === "INDEXED" ? "completed" : status === "FAILED" ? "failed" : "processing",
    step: stage,
    progress,
    message,
  });
};

const processVersionSynchronously = async (
  document: IDocument,
  version: IDocumentVersion,
  userId: string,
  uploadSessionId: string,
  file: Express.Multer.File,
  options: VersioningOptions,
): Promise<void> => {
  const dependencies = getDependencies(options);
  const documentId = document._id.toString();

  try {
    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "EXTRACTING_TEXT",
      10,
      "Extracting document text",
    );

    const extractionResult = await dependencies.extractText(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    version.extractedText = extractionResult.extractedText;
    version.extractionStatus = "COMPLETED";
    version.extractionError = "";
    await version.save();

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "CHUNKING",
      35,
      "Chunking document",
    );
    const chunkingResult = await dependencies.chunkText(version.extractedText);
    const documentOutline = extractDocumentOutline({
      text: version.extractedText,
      chunkingResult,
      semanticOutline: extractionResult.metadata?.semanticOutline || [],
    });
    const outlineSummary = summarizeDocumentOutline(documentOutline);
    const chunks = applyOutlineToChunks(chunkingResult.chunks, documentOutline);
    const structure = analyzeDocumentStructure(chunkingResult);
    version.totalChunks = chunks.length;
    version.chunkingStrategy = structure.chunkingStrategy;
    version.detectedSections =
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections;
    version.documentOutline = documentOutline;
    version.chapterCount = Math.max(
      outlineSummary.chapterCount,
      structure.chapterCount,
    );
    version.partCount = outlineSummary.partCount || structure.partCount;
    version.sectionCount = outlineSummary.sectionCount || structure.sectionCount;
    await version.save();

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "EMBEDDING",
      60,
      "Generating embeddings",
    );

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "UPSERTING_VECTOR",
      80,
      "Indexing document vectors",
    );

    const subject = await Subject.findOne({
      _id: document.subjectId,
      ownerId: document.ownerId,
    }).select("name");
    const vectorChunks = chunks.map((chunk) => ({
      documentId,
      versionId: version._id.toString(),
      versionNumber: version.versionNumber,
      ownerId: document.ownerId.toString(),
      userId,
      subject: subject?.name,
      subjectId: document.subjectId.toString(),
      title: document.title,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.metadata.heading,
      sectionTitle: chunk.metadata.sectionTitle,
      sectionIndex: chunk.metadata.sectionIndex,
      contentLength: chunk.metadata.contentLength,
      section: chunk.metadata.section,
      inferredSection: chunk.metadata.inferredSection,
      semanticSectionLabel: chunk.metadata.semanticSectionLabel,
      outlineNodeId: chunk.metadata.outlineNodeId,
      outlinePath: chunk.metadata.outlinePath,
      outlineLevel: chunk.metadata.outlineLevel,
      outlineType: chunk.metadata.outlineType,
      chapterOrdinal: chunk.metadata.chapterOrdinal,
      content: chunk.content,
      metadata: {
        heading: chunk.metadata.heading || "",
        sectionTitle: chunk.metadata.sectionTitle,
        sectionIndex: chunk.metadata.sectionIndex,
        contentLength: chunk.metadata.contentLength,
        chunkingStrategy: chunk.metadata.chunkingStrategy,
        textLength: chunk.metadata.textLength,
        visibility: document.visibility,
        isActiveVersion: version.isActive,
        versionNumber: version.versionNumber,
        versionId: version._id.toString(),
        ownerId: document.ownerId.toString(),
        section: chunk.metadata.section || "",
        inferredSection: chunk.metadata.inferredSection || "",
        semanticSectionLabel: chunk.metadata.semanticSectionLabel || "",
        outlineNodeId: chunk.metadata.outlineNodeId || "",
        outlinePath: chunk.metadata.outlinePath || "",
        outlineLevel: chunk.metadata.outlineLevel || 0,
        outlineType: chunk.metadata.outlineType || "",
        chapterOrdinal: chunk.metadata.chapterOrdinal || "",
      },
    }));

    await dependencies.upsertChunks(vectorChunks);
    const indexedAt = new Date();

    version.indexedAt = indexedAt;
    version.totalChunks = chunks.length;
    version.chunkingStrategy = structure.chunkingStrategy;
    version.detectedSections =
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections;
    version.documentOutline = documentOutline;
    version.chapterCount = Math.max(
      outlineSummary.chapterCount,
      structure.chapterCount,
    );
    version.partCount = outlineSummary.partCount || structure.partCount;
    version.sectionCount = outlineSummary.sectionCount || structure.sectionCount;
    version.processingStatus = "INDEXED";
    version.processingStage = "COMPLETED";
    version.processingProgress = 100;
    version.processingError = "";
    version.processingCompletedAt = indexedAt;
    await version.save();

    if (version.isActive) {
      await StudyDocument.updateOne(
        { _id: document._id },
        {
          $set: {
            currentVersionId: version._id,
            totalChunks: version.totalChunks,
            lastIndexedAt: indexedAt,
            fileUrl: version.fileUrl,
            filePublicId: version.filePublicId,
            fileName: version.fileName,
            fileType: version.fileType,
            originalFileName: version.originalFileName,
            storedFileName: version.storedFileName,
            fileExtension: version.fileExtension,
            mimeType: version.mimeType,
            fileSize: version.fileSize,
            extractedText: version.extractedText,
            extractionStatus: "COMPLETED",
            extractionError: "",
            chunkingStrategy: version.chunkingStrategy,
            detectedSections: version.detectedSections || [],
            documentOutline: version.documentOutline || [],
            chapterCount: version.chapterCount || 0,
            partCount: version.partCount || 0,
            sectionCount: version.sectionCount || 0,
          },
        },
      );
    }

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "INDEXED",
      "COMPLETED",
      100,
      "Document indexed successfully",
    );
  } catch (error) {
    const message = safeErrorMessage(error);

    version.processingStatus = "FAILED";
    version.processingStage = "FAILED";
    version.processingProgress = 100;
    version.processingError = message;
    version.processingCompletedAt = new Date();
    version.extractionStatus =
      version.extractedText?.trim() ? version.extractionStatus : "FAILED";
    version.extractionError =
      version.extractionStatus === "FAILED" ? message : version.extractionError;
    await version.save();

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "FAILED",
      "FAILED",
      100,
      "Document processing failed",
      message,
    );

    throw new AppError("DOCUMENT_PROCESSING_FAILED", 500);
  }
};

export const uploadDocumentVersion = async (
  documentId: string,
  userId: string,
  payload: UploadDocumentVersionRequest,
  file: Express.Multer.File | undefined,
  options: VersioningOptions = {},
): Promise<DocumentVersionResponse> => {
  if (!file) {
    throw new AppError("Document version file is required", 400);
  }

  const document = await getOwnedDocumentForVersionWrite(documentId, userId);

  if (document.status === "ARCHIVED") {
    throw new AppError("CANNOT_UPLOAD_TO_ARCHIVED_DOCUMENT", 409);
  }

  const uploadMode: DocumentVersionUploadMode = payload.uploadMode;
  const makeActive =
    uploadMode === "OVERRIDE"
      ? true
      : parseBoolean(payload.makeActive, true);
  const latestVersion = await DocumentVersion.findOne({
    documentId,
    deletedAt: null,
  }).sort({ versionNumber: -1 });
  const versionNumber = (latestVersion?.versionNumber || 0) + 1;
  const dependencies = getDependencies(options);
  const cloudinaryUpload = await dependencies.uploadFile(file);
  const shouldActivate = makeActive;

  if (shouldActivate) {
    await DocumentVersion.updateMany(
      { documentId, isActive: true },
      { $set: { isActive: false } },
    );
  }

  const version = await DocumentVersion.create({
    documentId,
    versionNumber,
    uploadMode,
    fileUrl: cloudinaryUpload.result.secure_url,
    filePublicId: cloudinaryUpload.result.public_id,
    fileName: file.originalname,
    originalFileName: cloudinaryUpload.originalFileName,
    storedFileName: cloudinaryUpload.storedFileName,
    fileType: file.mimetype,
    mimeType: cloudinaryUpload.mimeType,
    fileSize: file.size,
    fileExtension: cloudinaryUpload.fileExtension,
    extractedText: "",
    extractionStatus: "PENDING",
    extractionError: "",
    processingStatus: "PENDING",
    processingStage: "UPLOADED",
    processingProgress: 0,
    processingError: "",
    totalChunks: 0,
    indexedAt: null,
    uploadedBy: new Types.ObjectId(userId),
    uploadReason: payload.uploadReason,
    isActive: shouldActivate,
  });

  await StudyDocument.updateOne(
    { _id: documentId },
    {
      $inc: { totalVersions: 1 },
      ...(shouldActivate ? { $set: { currentVersionId: version._id } } : {}),
    },
  );

  const uploadSession = await UploadSession.create({
    userId: new Types.ObjectId(userId),
    documentId: version.documentId,
    versionId: version._id,
    status: "PROCESSING",
    stage: "UPLOADED",
    progress: 0,
    message: "Document upload started",
  });

  dependencies.emitProgress("upload:started", {
    documentId,
    uploadSessionId: uploadSession._id.toString(),
    versionId: version._id.toString(),
    status: "processing",
    step: "UPLOADED",
    progress: 0,
    message: "Document upload started",
  });
  dependencies.emitProgress("upload:processing", {
    documentId,
    uploadSessionId: uploadSession._id.toString(),
    versionId: version._id.toString(),
    status: "processing",
    step: "UPLOADED",
    progress: 5,
    message: "Document saved and processing started",
  });

  version.processingStatus = "PROCESSING";
  version.processingProgress = 5;
  version.uploadSessionId = uploadSession._id;
  await version.save();
  uploadSession.progress = 5;
  uploadSession.message = "Document saved and processing started";
  await uploadSession.save();

  await processVersionSynchronously(
    document,
    version,
    userId,
    uploadSession._id.toString(),
    file,
    {
      ...options,
      dependencies,
    },
  );

  return toVersionResponse(version);
};

export const getDocumentVersions = async (
  documentId: string,
  userId: string,
  query: ListDocumentVersionsQuery = {},
): Promise<{ data: DocumentVersionResponse[]; pagination: PaginationResponse }> => {
  const { document, isOwner } = await getReadableDocument(documentId, userId);
  const { page, limit, skip } = paginate(query);
  const filters: Record<string, unknown> = {
    documentId: document._id,
    deletedAt: null,
  };

  if (!isOwner) {
    filters.isActive = true;
  }

  const [versions, totalItems] = await Promise.all([
    DocumentVersion.find(filters)
      .select("-extractedText")
      .sort({ versionNumber: -1 })
      .skip(skip)
      .limit(limit),
    DocumentVersion.countDocuments(filters),
  ]);

  return {
    data: versions.map((version) => toVersionResponse(version)),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const getDocumentVersionDetail = async (
  documentId: string,
  versionId: string,
  userId: string,
  query: GetDocumentVersionDetailQuery = {},
): Promise<DocumentVersionResponse> => {
  const { document, isOwner } = await getReadableDocument(documentId, userId);
  const version = await DocumentVersion.findOne({
    _id: versionId,
    documentId: document._id,
    deletedAt: null,
    ...(isOwner ? {} : { isActive: true }),
  });

  if (!version) {
    throw new AppError("VERSION_NOT_FOUND", 404);
  }

  return toVersionResponse(version, parseBoolean(query.includeText, false));
};

export const activateDocumentVersion = async (
  documentId: string,
  versionId: string,
  userId: string,
  options: VersioningOptions = {},
): Promise<DocumentVersionResponse> => {
  const document = await getOwnedDocumentForVersionWrite(documentId, userId);
  const version = await DocumentVersion.findOne({
    _id: versionId,
    documentId: document._id,
    deletedAt: null,
  });

  if (!version) {
    throw new AppError("VERSION_NOT_FOUND", 404);
  }

  await DocumentVersion.updateMany(
    { documentId: document._id, isActive: true },
    { $set: { isActive: false } },
  );

  version.isActive = true;
  await version.save();
  await updateDocumentFromActiveVersion(documentId, version);
  const reindexResult = await maybeReindexActiveVersion(documentId, userId, options);

  if (reindexResult) {
    version.indexedAt = reindexResult.indexedAt;
    version.totalChunks = reindexResult.chunksCreated;
    version.chunkingStrategy = reindexResult.chunkingStrategy;
    version.detectedSections = reindexResult.detectedSections;
    version.documentOutline = reindexResult.documentOutline || [];
    version.chapterCount = reindexResult.chapterCount;
    version.partCount = reindexResult.partCount;
    version.sectionCount = reindexResult.sectionCount;
    await version.save();
    await StudyDocument.updateOne(
      { _id: documentId },
      {
        $set: {
          lastIndexedAt: reindexResult.indexedAt,
          totalChunks: reindexResult.chunksCreated,
          chunkingStrategy: reindexResult.chunkingStrategy,
          detectedSections: reindexResult.detectedSections,
          documentOutline: reindexResult.documentOutline || [],
          chapterCount: reindexResult.chapterCount,
          partCount: reindexResult.partCount,
          sectionCount: reindexResult.sectionCount,
        },
      },
    );
  }

  return toVersionResponse(version);
};

export const reindexDocumentVersion = async (
  documentId: string,
  versionId: string,
  userId: string,
  options: VersioningOptions = {},
): Promise<{
  documentId: string;
  versionId: string;
  uploadSessionId: string;
  status: string;
  progress: number;
}> => {
  const document = await getOwnedDocumentForVersionWrite(documentId, userId);
  const version = await DocumentVersion.findOne({
    _id: versionId,
    documentId: document._id,
    deletedAt: null,
  });

  if (!version) {
    throw new AppError("VERSION_NOT_FOUND", 404);
  }

  const uploadSession = await UploadSession.create({
    userId: new Types.ObjectId(userId),
    documentId: document._id,
    versionId: version._id,
    status: "PROCESSING",
    stage: "UPLOADED",
    progress: 0,
    message: "Document reindex started",
  });
  const dependencies = getDependencies(options);
  const uploadSessionId = uploadSession._id.toString();

  version.uploadSessionId = uploadSession._id;
  await version.save();

  dependencies.emitProgress("upload:started", {
    documentId,
    uploadSessionId,
    versionId,
    status: "processing",
    step: "UPLOADED",
    progress: 0,
    message: "Document reindex started",
  });

  await updateProcessingProgress(
    documentId,
    version,
    uploadSessionId,
    dependencies,
    "PROCESSING",
    "CHUNKING",
    35,
    "Chunking document",
  );

  try {
    if (!version.extractedText.trim()) {
      throw new AppError("VERSION_TEXT_NOT_AVAILABLE", 409);
    }

    const chunkingResult = await dependencies.chunkText(version.extractedText);
    const documentOutline = extractDocumentOutline({
      text: version.extractedText,
      chunkingResult,
      semanticOutline: version.documentOutline || [],
    });
    const outlineSummary = summarizeDocumentOutline(documentOutline);
    const chunks = applyOutlineToChunks(chunkingResult.chunks, documentOutline);
    const structure = analyzeDocumentStructure(chunkingResult);
    version.totalChunks = chunks.length;
    version.chunkingStrategy = structure.chunkingStrategy;
    version.detectedSections =
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections;
    version.documentOutline = documentOutline;
    version.chapterCount = Math.max(
      outlineSummary.chapterCount,
      structure.chapterCount,
    );
    version.partCount = outlineSummary.partCount || structure.partCount;
    version.sectionCount = outlineSummary.sectionCount || structure.sectionCount;
    await version.save();

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "EMBEDDING",
      60,
      "Generating embeddings",
    );
    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "PROCESSING",
      "UPSERTING_VECTOR",
      80,
      "Reindexing document vectors",
    );

    await dependencies.deleteChunks(documentId, userId);

    const subject = await Subject.findOne({
      _id: document.subjectId,
      ownerId: document.ownerId,
    }).select("name");
    const vectorChunks = chunks.map((chunk) => ({
      documentId,
      versionId: version._id.toString(),
      versionNumber: version.versionNumber,
      ownerId: document.ownerId.toString(),
      userId,
      subject: subject?.name,
      subjectId: document.subjectId.toString(),
      title: document.title,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.metadata.heading,
      sectionTitle: chunk.metadata.sectionTitle,
      sectionIndex: chunk.metadata.sectionIndex,
      contentLength: chunk.metadata.contentLength,
      section: chunk.metadata.section,
      inferredSection: chunk.metadata.inferredSection,
      semanticSectionLabel: chunk.metadata.semanticSectionLabel,
      outlineNodeId: chunk.metadata.outlineNodeId,
      outlinePath: chunk.metadata.outlinePath,
      outlineLevel: chunk.metadata.outlineLevel,
      outlineType: chunk.metadata.outlineType,
      chapterOrdinal: chunk.metadata.chapterOrdinal,
      content: chunk.content,
      metadata: {
        heading: chunk.metadata.heading || "",
        sectionTitle: chunk.metadata.sectionTitle,
        sectionIndex: chunk.metadata.sectionIndex,
        contentLength: chunk.metadata.contentLength,
        chunkingStrategy: chunk.metadata.chunkingStrategy,
        textLength: chunk.metadata.textLength,
        visibility: document.visibility,
        isActiveVersion: version.isActive,
        versionNumber: version.versionNumber,
        versionId: version._id.toString(),
        ownerId: document.ownerId.toString(),
        section: chunk.metadata.section || "",
        inferredSection: chunk.metadata.inferredSection || "",
        semanticSectionLabel: chunk.metadata.semanticSectionLabel || "",
        outlineNodeId: chunk.metadata.outlineNodeId || "",
        outlinePath: chunk.metadata.outlinePath || "",
        outlineLevel: chunk.metadata.outlineLevel || 0,
        outlineType: chunk.metadata.outlineType || "",
        chapterOrdinal: chunk.metadata.chapterOrdinal || "",
      },
    }));

    await dependencies.upsertChunks(vectorChunks);
    const indexedAt = new Date();

    version.indexedAt = indexedAt;
    version.totalChunks = chunks.length;
    version.chunkingStrategy = structure.chunkingStrategy;
    version.detectedSections =
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : structure.detectedSections;
    version.documentOutline = documentOutline;
    version.chapterCount = Math.max(
      outlineSummary.chapterCount,
      structure.chapterCount,
    );
    version.partCount = outlineSummary.partCount || structure.partCount;
    version.sectionCount = outlineSummary.sectionCount || structure.sectionCount;
    await version.save();

    if (version.isActive) {
      await updateDocumentFromActiveVersion(documentId, version);
      await StudyDocument.updateOne(
        { _id: documentId },
        { $set: { lastIndexedAt: indexedAt, totalChunks: chunks.length } },
      );
    }

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "INDEXED",
      "COMPLETED",
      100,
      "Document reindexed successfully",
    );
  } catch (error) {
    const message = safeErrorMessage(error);

    await updateProcessingProgress(
      documentId,
      version,
      uploadSessionId,
      dependencies,
      "FAILED",
      "FAILED",
      100,
      "Document reindex failed",
      message,
    );

    throw error;
  }

  return {
    documentId,
    versionId,
    uploadSessionId,
    status: "COMPLETED",
    progress: 100,
  };
};

export const deleteDocumentVersion = async (
  documentId: string,
  versionId: string,
  userId: string,
): Promise<void> => {
  const document = await getOwnedDocumentForVersionWrite(documentId, userId);
  const version = await DocumentVersion.findOne({
    _id: versionId,
    documentId: document._id,
    deletedAt: null,
  });

  if (!version) {
    throw new AppError("VERSION_NOT_FOUND", 404);
  }

  if (version.isActive) {
    throw new AppError("CANNOT_DELETE_ACTIVE_VERSION", 409);
  }

  await DocumentVersion.updateOne(
    { _id: version._id },
    { $set: { deletedAt: new Date() } },
  );
};
