import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { ReindexDocumentResponse } from "../types/api.types";
import { splitTextForRag } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import {
  deleteDocumentChunks,
  upsertDocumentChunks,
} from "./vector.service";
import { analyzeDocumentStructure } from "../utils/documentStructure";
import {
  applyOutlineToChunks,
  extractDocumentOutline,
  summarizeDocumentOutline,
} from "../utils/documentOutline";

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

export const indexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<Omit<ReindexDocumentResponse, "deletedVectorCount">> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  });

  if (!document || !document.extractedText.trim()) {
    return {
      documentId,
      chunksCreated: 0,
      detectedSections: [],
      documentOutline: [],
      chapterCount: 0,
      partCount: 0,
      sectionCount: 0,
      upsertedVectorCount: 0,
    };
  }

  const subjectName = await getSubjectNameForUser(
    document.subjectId?.toString(),
    userId,
  );
  const activeVersion = document.currentVersionId
    ? await DocumentVersion.findOne({
        _id: document.currentVersionId,
        documentId: document._id,
        isActive: true,
        deletedAt: null,
      }).select("_id versionNumber")
    : undefined;

  const chunkingResult = await splitTextForRag(document.extractedText);
  const outline = extractDocumentOutline({
    text: document.extractedText,
    chunkingResult,
    semanticOutline: document.documentOutline,
  });
  const outlineSummary = summarizeDocumentOutline(outline);
  const fallbackStructure = analyzeDocumentStructure(chunkingResult);
  const chunks = applyOutlineToChunks(chunkingResult.chunks, outline);

  const vectorChunks = chunks.map((chunk) => ({
    documentId: document._id.toString(),
    versionId: activeVersion?._id.toString(),
    versionNumber: activeVersion?.versionNumber,
    ownerId: document.ownerId.toString(),
    userId,
    subject: subjectName,
    subjectId: document.subjectId?.toString(),
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
  const upsertedVectorCount = await upsertDocumentChunks(vectorChunks);

  console.log("[RAG reindex] Indexed document chunks", {
    documentId,
    chunkingStrategy: chunkingResult.chunkingStrategy,
    chunksCreated: chunks.length,
    detectedSections: outlineSummary.detectedSections,
    upsertedVectorCount,
  });

  return {
    documentId,
    chunkingStrategy: chunkingResult.chunkingStrategy,
    chunksCreated: chunks.length,
    detectedSections:
      outlineSummary.detectedSections.length > 0
        ? outlineSummary.detectedSections
        : fallbackStructure.detectedSections,
    documentOutline: outline,
    chapterCount: Math.max(
      outlineSummary.chapterCount,
      fallbackStructure.chapterCount,
    ),
    partCount: outlineSummary.partCount || fallbackStructure.partCount,
    sectionCount: outlineSummary.sectionCount || fallbackStructure.sectionCount,
    upsertedVectorCount,
  };
};

export const reindexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<ReindexDocumentResponse> => {
  const deleteResult = await deleteDocumentChunks(documentId, userId);
  const indexResult = await indexDocumentForRag(documentId, userId);
  const result = {
    ...indexResult,
    deletedVectorCount: deleteResult.deletedVectorCount,
  };

  console.log("[RAG reindex] Document reindexed", result);

  return result;
};

export const reembedDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<ReindexDocumentResponse> => {
  return reindexDocumentForRag(documentId, userId);
};

export const removeDocumentFromRag = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  await deleteDocumentChunks(documentId, userId);
};
