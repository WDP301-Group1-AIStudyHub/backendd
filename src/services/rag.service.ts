import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatSource,
  ReindexDocumentResponse,
} from "../types/api.types";
import { RagAnswerResult } from "../types/rag.types";
import { splitTextForRag } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./groq.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import {
  detectAnswerStyle,
} from "../utils/answerStyle";
import { classifyQuestionIntent } from "./intentClassifier.service";
import {
  detectAnswerProfile,
  shouldTreatAsSummaryIntent,
} from "../utils/answerProfile";
import {
  calculateAverageRelevance,
  evaluateRetrievedChunks,
} from "./relevance.service";
import { selectContextChunksForQuestion } from "./sectionContext.service";
import {
  deleteDocumentChunks,
  searchRelevantChunks,
  upsertDocumentChunks,
} from "./vector.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { analyzeDocumentStructure } from "../utils/documentStructure";
import {
  applyOutlineToChunks,
  extractDocumentOutline,
  summarizeDocumentOutline,
} from "../utils/documentOutline";

const DEFAULT_CONTEXT_CHUNK_LIMIT = 8;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 4;
const RETRIEVAL_TOP_K = 12;
const DETAILED_RETRIEVAL_TOP_K = 20;
const DETAILED_CONTEXT_CHUNK_LIMIT = 16;
const DOCUMENT_PROCESSING_MESSAGE =
  "Tài liệu đang được xử lý, vui lòng thử lại sau.";

type ActiveVersionProcessingSnapshot = {
  processingStatus?: string;
  indexedAt?: Date | null;
  totalChunks?: number;
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

  // RAG indexing only sees normalized plain text. Embedding models do not read
  // PDF/Office binaries directly, so format-specific parsing happens before
  // this unchanged chunking and vector storage step.
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
    chapterCount: outlineSummary.chapterCount || fallbackStructure.chapterCount,
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
  // Re-embedding deletes stale Pinecone vectors, regenerates chunks with the
  // latest section metadata, then upserts fresh embeddings.
  return reindexDocumentForRag(documentId, userId);
};

export const removeDocumentFromRag = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  await deleteDocumentChunks(documentId, userId);
};

export const askQuestionWithRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();
  let documentTitle: string | undefined;
  let documentSubject = payload.subject;
  let subjectIdFilter = payload.subjectId;
  const processingResponse = (): RagAnswerResult => ({
    answer: DOCUMENT_PROCESSING_MESSAGE,
    mode: "basic",
    originalQuestion: payload.question,
    sources: [],
    evaluation: {
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      correctiveAttempted: false,
      isGrounded: false,
      confidenceScore: 0,
      responseTimeMs: Date.now() - startedAt,
      fallbackGenerated: true,
      fallbackReason: "document_processing",
      retrievedSections: [],
    },
  });

  if (payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: payload.documentId,
      ownerId: userId,
      status: { $ne: "DELETED" },
    });

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    documentTitle = document.title;
    subjectIdFilter = document.subjectId?.toString();
    documentSubject =
      (await getSubjectNameForUser(subjectIdFilter, userId)) || documentSubject;
    if (document.currentVersionId) {
      const activeVersion = await DocumentVersion.findOne({
        _id: document.currentVersionId,
        documentId: document._id,
        isActive: true,
        deletedAt: null,
      }).select("processingStatus indexedAt totalChunks");

      if (!isActiveVersionReadyForChat(activeVersion)) {
        return processingResponse();
      }
    }
  } else if (payload.subjectId) {
    documentSubject = await getSubjectNameForUser(payload.subjectId, userId);
  }

  const intentClassification = await classifyQuestionIntent(payload.question);
  const answerProfile = detectAnswerProfile(
    payload.question,
    intentClassification.intent,
  );
  const intent = shouldTreatAsSummaryIntent(
    intentClassification.intent,
    answerProfile,
  )
    ? "summary"
    : intentClassification.intent;
  const answerStyle = detectAnswerStyle(payload.question);
  const retrievalTopK = answerProfile.wantsDetailedAnswer
    ? DETAILED_RETRIEVAL_TOP_K
    : RETRIEVAL_TOP_K;

  // RAG retrieval: Pinecone filters by user and optionally document/subject,
  // then returns the most relevant chunks for the user's question.
  const chunks = await searchRelevantChunks(
    payload.question,
    {
      userId,
      documentId: payload.documentId,
      subject: payload.documentId ? undefined : payload.subject,
      subjectId: payload.documentId ? undefined : subjectIdFilter,
    },
    retrievalTopK,
  );
  const evaluatedChunks = evaluateRetrievedChunks(payload.question, chunks);
  const relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  const averageRelevanceScore = calculateAverageRelevance(evaluatedChunks);

  if (chunks.length === 0) {
    const fallbackReason = "no_relevant_chunks_found";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      documentTitle,
      subject: documentSubject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: "basic",
      originalQuestion: payload.question,
      sources: [],
      evaluation: {
        retrievedChunksCount: 0,
        relevantChunksCount: 0,
        averageRelevanceScore: 0,
        correctiveAttempted: false,
        isGrounded: false,
        confidenceScore: 0,
        responseTimeMs: Date.now() - startedAt,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        retrievedSections: [],
        answerProfile: answerProfile.profile,
        usedSectionExpansion: false,
        contextChunksUsed: 0,
      },
    };
  }

  const contextSelection = answerProfile.wantsDetailedAnswer
    ? await selectContextChunksForQuestion(payload.question, evaluatedChunks, {
        maxChunks: DETAILED_CONTEXT_CHUNK_LIMIT,
      })
    : {
        chunks: evaluatedChunks,
        usedSectionExpansion: false,
        selectedSectionTitle: undefined,
      };
  const relevanceScoreByChunkId = new Map(
    evaluatedChunks.map((chunk) => [chunk.id, chunk.relevanceScore]),
  );

  const answerChunks =
    intent === "extraction" || answerStyle.wantsShortAnswer
      ? [...contextSelection.chunks]
          .sort((a, b) => (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0))
          .slice(0, FOCUSED_CONTEXT_CHUNK_LIMIT)
      : contextSelection.chunks.slice(
          0,
          answerProfile.wantsDetailedAnswer
            ? DETAILED_CONTEXT_CHUNK_LIMIT
            : DEFAULT_CONTEXT_CHUNK_LIMIT,
        );

  const context = answerChunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}${
          chunk.metadata.sectionTitle
            ? `, section ${chunk.metadata.sectionTitle}`
            : ""
        }\n${chunk.content}`,
    )
    .join("\n\n");

  let answer =
    intent === "extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
          answerProfile: answerProfile.profile,
        });
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer =
      intent === "extraction"
        ? await generateEntityExtractionAnswer(payload.question, context)
        : await generateAnswerFromContext(payload.question, context, true, {
            intent,
            answerProfile: answerProfile.profile,
          });
    grounding = await checkAnswerGrounding(answer, context);
  }

  const sources: ChatSource[] = answerChunks.map((chunk) => ({
    documentId: chunk.metadata.documentId,
    title: chunk.metadata.title,
    chunkIndex: Number(chunk.metadata.chunkIndex),
    section: chunk.metadata.section,
    inferredSection: chunk.metadata.inferredSection,
    semanticSectionLabel: chunk.metadata.semanticSectionLabel,
    heading: chunk.metadata.heading,
    sectionTitle: chunk.metadata.sectionTitle,
    sectionIndex: chunk.metadata.sectionIndex,
    outlineNodeId: chunk.metadata.outlineNodeId,
    outlinePath: chunk.metadata.outlinePath,
    outlineLevel: chunk.metadata.outlineLevel,
    outlineType: chunk.metadata.outlineType,
    chapterOrdinal: chunk.metadata.chapterOrdinal,
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
    relevanceScore:
      relevanceScoreByChunkId.get(chunk.id) ?? chunk.pineconeScore ?? 0,
  }));

  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: chunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      documentTitle: documentTitle || answerChunks[0]?.metadata.title,
      subject: documentSubject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: "basic",
      originalQuestion: payload.question,
      sources,
      evaluation: {
        retrievedChunksCount: chunks.length,
        relevantChunksCount: relevantChunks.length,
        averageRelevanceScore,
        correctiveAttempted: false,
        isGrounded: false,
        confidenceScore: grounding.confidenceScore,
        responseTimeMs: Date.now() - startedAt,
        warning: grounding.warning,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        answerProfile: answerProfile.profile,
        usedSectionExpansion: contextSelection.usedSectionExpansion,
        selectedSectionTitle: contextSelection.selectedSectionTitle,
        contextChunksUsed: answerChunks.length,
        retrievedSections: [
          ...new Set(
            chunks
              .map(
                (chunk) =>
                  chunk.metadata.sectionTitle ||
                  chunk.metadata.inferredSection ||
                  chunk.metadata.section ||
                  "",
              )
              .filter(Boolean),
          ),
        ],
      },
    };
  }

  return {
    answer,
    mode: "basic",
    originalQuestion: payload.question,
    sources,
    evaluation: {
      retrievedChunksCount: chunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      correctiveAttempted: false,
      isGrounded: grounding.isGrounded,
      confidenceScore: grounding.confidenceScore,
      responseTimeMs: Date.now() - startedAt,
      warning: grounding.warning,
      fallbackGenerated: false,
      detectedIntent: intent,
      answerProfile: answerProfile.profile,
      usedSectionExpansion: contextSelection.usedSectionExpansion,
      selectedSectionTitle: contextSelection.selectedSectionTitle,
      contextChunksUsed: answerChunks.length,
      retrievedSections: [
        ...new Set(
          chunks
            .map(
              (chunk) =>
                chunk.metadata.sectionTitle ||
                chunk.metadata.inferredSection ||
                chunk.metadata.section ||
                "",
            )
            .filter(Boolean),
        ),
      ],
    },
  };
};
