import { isValidObjectId } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { AskQuestionRequest } from "../types/api.types";
import { RagAnswerResult } from "../types/rag.types";
import {
  analyzeDocumentStructure,
  detectStructuralQuestion,
  formatStructureCountAnswer,
  getSectionsForUnit,
  getStructureNotFoundAnswer,
} from "../utils/documentStructure";
import { splitTextForRag } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import {
  extractDocumentOutline,
  getOutlineNodesByType,
  type DocumentOutlineNode,
} from "../utils/documentOutline";
import { extractOutlineWithLlmFallback } from "./documentOutlineLlm.service";

const DOCUMENT_PROCESSING_MESSAGE =
  "Tài liệu đang được xử lý, vui lòng thử lại sau.";

type ActiveVersionProcessingSnapshot = {
  processingStatus?: string;
  indexedAt?: Date | null;
  totalChunks?: number;
  documentOutline?: DocumentOutlineNode[];
};

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

const buildEvaluation = ({
  fallbackGenerated,
  fallbackReason,
  isGrounded,
  responseTimeMs,
}: {
  fallbackGenerated: boolean;
  fallbackReason?: string;
  isGrounded: boolean;
  responseTimeMs: number;
}) => ({
  retrievedChunksCount: 0,
  relevantChunksCount: 0,
  averageRelevanceScore: 0,
  isGrounded,
  confidenceScore: isGrounded ? 1 : 0,
  responseTimeMs,
  stageOneChunksCount: 0,
  stageTwoChunksCount: 0,
  selectedStaticChunksCount: 0,
  selectedDynamicChunksCount: 0,
  dynamicRetrievalAttempted: false,
  selectionStrategy: "cfs-heuristic" as const,
  retrievalQueries: [],
  fallbackGenerated,
  fallbackReason,
  detectedIntent: "document_structure",
  retrievedSections: [],
  usedSectionExpansion: false,
  contextChunksUsed: 0,
});

const buildResult = ({
  answer,
  originalQuestion,
  responseTimeMs,
  fallbackGenerated = false,
  fallbackReason,
  isGrounded = true,
}: {
  answer: string;
  originalQuestion: string;
  responseTimeMs: number;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  isGrounded?: boolean;
}): RagAnswerResult => ({
  answer,
  mode: "dr-rag",
  originalQuestion,
  sources: [],
  evaluation: buildEvaluation({
    fallbackGenerated,
    fallbackReason,
    isGrounded,
    responseTimeMs,
  }),
});

const getSectionsFromOutline = (
  outline: DocumentOutlineNode[],
  unit: "chapter" | "part" | "section",
): string[] => {
  if (unit === "chapter") {
    return getOutlineNodesByType(outline, "chapter").map((node) => node.title);
  }

  if (unit === "part") {
    return getOutlineNodesByType(outline, "part").map((node) => node.title);
  }

  return [
    ...getOutlineNodesByType(outline, "section"),
    ...getOutlineNodesByType(outline, "subsection"),
  ].map((node) => node.title);
};

export const answerDocumentStructureQuestion = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult | null> => {
  const structuralQuestion = detectStructuralQuestion(payload.question);

  if (!structuralQuestion) {
    return null;
  }

  const startedAt = Date.now();

  if (payload.documentIds?.length || payload.scope === "subject_all") {
    return buildResult({
      answer:
        "Vui lòng chọn một tài liệu cụ thể để mình có thể kiểm tra số chương, phần hoặc section của tài liệu đó. Mình không cộng gộp cấu trúc khi bạn đang chọn nhiều tài liệu hoặc toàn bộ môn học.",
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "single_document_required",
      isGrounded: false,
    });
  }

  if (!payload.documentId) {
    return buildResult({
      answer:
        "Vui lòng chọn một tài liệu cụ thể để mình có thể kiểm tra số chương, phần hoặc section của tài liệu đó.",
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_required",
      isGrounded: false,
    });
  }

  const document = await StudyDocument.findOne({
    _id: payload.documentId,
    ownerId: userId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  if (!document.extractedText?.trim()) {
    return buildResult({
      answer: getStructureNotFoundAnswer(structuralQuestion.unit),
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_text_not_available",
      isGrounded: false,
    });
  }

  const activeVersion = document.currentVersionId
    ? await DocumentVersion.findOne({
        _id: document.currentVersionId,
        documentId: document._id,
        isActive: true,
        deletedAt: null,
      }).select("processingStatus indexedAt totalChunks documentOutline")
    : null;

  if (!isActiveVersionReadyForChat(activeVersion)) {
    return buildResult({
      answer: DOCUMENT_PROCESSING_MESSAGE,
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_processing",
      isGrounded: false,
    });
  }

  let documentOutline =
    activeVersion?.documentOutline?.length
      ? activeVersion.documentOutline
      : document.documentOutline || [];
  let chunkingResult:
    | Awaited<ReturnType<typeof splitTextForRag>>
    | undefined;

  if (documentOutline.length === 0) {
    chunkingResult = await splitTextForRag(document.extractedText);
    documentOutline = extractDocumentOutline({
      text: document.extractedText,
      chunkingResult,
    });

    if (documentOutline.length === 0) {
      documentOutline = await extractOutlineWithLlmFallback({
        text: document.extractedText,
        cacheKey:
          document.currentVersionId?.toString?.() ||
          document._id?.toString?.() ||
          payload.documentId,
      });
    }

    if (documentOutline.length > 0 && isValidObjectId(document._id)) {
      try {
        await Promise.all([
          StudyDocument.updateOne(
            { _id: document._id },
            { $set: { documentOutline } },
          ),
          document.currentVersionId
            ? DocumentVersion.updateOne(
                {
                  _id: document.currentVersionId,
                  documentId: document._id,
                  isActive: true,
                  deletedAt: null,
                },
                { $set: { documentOutline } },
              )
            : Promise.resolve(),
        ]);
      } catch (error) {
        console.warn("[Document structure] Could not cache computed outline", {
          documentId: document._id?.toString?.() || payload.documentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const outlineSections = getSectionsFromOutline(
    documentOutline,
    structuralQuestion.unit,
  );
  let sections = outlineSections;

  if (structuralQuestion.unit !== "section") {
    chunkingResult ??= await splitTextForRag(document.extractedText);
    const fallbackSections = getSectionsForUnit(
      analyzeDocumentStructure(chunkingResult),
      structuralQuestion.unit,
    );

    if (fallbackSections.length > outlineSections.length) {
      sections = fallbackSections;
    }
  }

  if (sections.length === 0) {
    return buildResult({
      answer: getStructureNotFoundAnswer(structuralQuestion.unit),
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_structure_not_found",
      isGrounded: false,
    });
  }

  return buildResult({
    answer: formatStructureCountAnswer(structuralQuestion.unit, sections),
    originalQuestion: payload.question,
    responseTimeMs: Date.now() - startedAt,
  });
};
