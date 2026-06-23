import { isValidObjectId } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { AskQuestionRequest } from "../types/api.types";
import { RagAnswerResult, RagMode } from "../types/rag.types";
import {
  detectStructuralQuestion,
  formatStructureCountAnswer,
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
  correctiveAttempted: false,
  isGrounded,
  confidenceScore: isGrounded ? 1 : 0,
  responseTimeMs,
  fallbackGenerated,
  fallbackReason,
  detectedIntent: "document_structure",
  retrievedSections: [],
  usedSectionExpansion: false,
  contextChunksUsed: 0,
});

const buildResult = ({
  answer,
  mode,
  originalQuestion,
  responseTimeMs,
  fallbackGenerated = false,
  fallbackReason,
  isGrounded = true,
}: {
  answer: string;
  mode: RagMode;
  originalQuestion: string;
  responseTimeMs: number;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  isGrounded?: boolean;
}): RagAnswerResult => ({
  answer,
  mode,
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
  const mode = payload.mode || "basic";

  if (payload.documentIds?.length || payload.scope === "subject_all") {
    return buildResult({
      answer:
        "Vui lòng chọn một tài liệu cụ thể để mình có thể kiểm tra số chương, phần hoặc section của tài liệu đó. Mình không cộng gộp cấu trúc khi bạn đang chọn nhiều tài liệu hoặc toàn bộ môn học.",
      mode,
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
      mode,
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
      mode,
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
      mode,
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

  if (documentOutline.length === 0) {
    const chunkingResult = await splitTextForRag(document.extractedText);
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

  const sections = getSectionsFromOutline(documentOutline, structuralQuestion.unit);

  if (sections.length === 0) {
    return buildResult({
      answer: getStructureNotFoundAnswer(structuralQuestion.unit),
      mode,
      originalQuestion: payload.question,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_structure_not_found",
      isGrounded: false,
    });
  }

  return buildResult({
    answer: formatStructureCountAnswer(structuralQuestion.unit, sections),
    mode,
    originalQuestion: payload.question,
    responseTimeMs: Date.now() - startedAt,
  });
};
