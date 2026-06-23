import { AskQuestionRequest, ChatSource } from "../types/api.types";
import { EvaluatedChunk, RagAnswerResult } from "../types/rag.types";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { AppError } from "../middlewares/error.middleware";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./groq.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";
import {
  calculateAverageRelevance,
  evaluateRetrievedChunks,
} from "./relevance.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { searchRelevantChunks, searchRelevantChunksPerDocument } from "./vector.service";
import { resolveChatScope } from "./chatScope.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import {
  detectAnswerProfile,
  shouldTreatAsSummaryIntent,
} from "../utils/answerProfile";
import { selectContextChunksForQuestion } from "./sectionContext.service";
import {
  classifyQuestionIntent,
  SemanticQuestionIntent,
} from "./intentClassifier.service";
import { RAG_CONFIG } from "../config/rag.config";
import { generateFallbackAnswer } from "./fallbackAnswer.service";

const DEFAULT_CONTEXT_CHUNK_LIMIT = 5;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 3;
const DETAILED_CONTEXT_CHUNK_LIMIT = 16;
const DEFAULT_RETRIEVAL_TOP_K = 8;
const DETAILED_RETRIEVAL_TOP_K = 20;
const MULTI_DOCUMENT_RETRIEVAL_TOP_K = 24;
const MULTI_DOCUMENT_DETAILED_RETRIEVAL_TOP_K = 40;
const DOCUMENT_PROCESSING_MESSAGE =
  "Tài liệu đang được xử lý, vui lòng thử lại sau.";

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

const buildContext = (chunks: EvaluatedChunk[]): string => {
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}${
          chunk.metadata.sectionTitle
            ? `, section ${chunk.metadata.sectionTitle}`
            : ""
        }, chunk ${chunk.metadata.chunkIndex}\n${chunk.content}`,
    )
    .join("\n\n");
};
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

const dedupeChunks = (chunks: EvaluatedChunk[]): EvaluatedChunk[] => {
  const byId = new Map<string, EvaluatedChunk>();

  chunks.forEach((chunk) => {
    const existing = byId.get(chunk.id);

    if (!existing || chunk.relevanceScore > existing.relevanceScore) {
      byId.set(chunk.id, chunk);
    }
  });

  return [...byId.values()];
};

const toSources = (chunks: EvaluatedChunk[]): ChatSource[] => {
  return chunks.map((chunk) => ({
    documentId: chunk.metadata.documentId,
    title: chunk.metadata.title,
    chunkIndex: chunk.metadata.chunkIndex,
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
    relevanceScore: chunk.relevanceScore,
  }));
};

const selectAnswerChunks = (
  chunks: EvaluatedChunk[],
  intent: SemanticQuestionIntent,
  wantsShortAnswer: boolean,
  wantsDetailedAnswer = false,
): EvaluatedChunk[] => {
  const maxChunks =
    intent === "extraction" || wantsShortAnswer
      ? FOCUSED_CONTEXT_CHUNK_LIMIT
      : wantsDetailedAnswer
        ? DETAILED_CONTEXT_CHUNK_LIMIT
      : DEFAULT_CONTEXT_CHUNK_LIMIT;

  if (wantsDetailedAnswer && intent !== "extraction" && !wantsShortAnswer) {
    return [...chunks]
      .sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex)
      .slice(0, maxChunks);
  }

  // Document-type independent context selection: rank by retrieval/evaluation
  // relevance only, without assuming any document category or domain.
  return [...chunks]
    .filter((chunk) => chunk.relevanceScore >= RAG_CONFIG.relevanceThreshold)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxChunks);
};

const getRetrievedSections = (chunks: EvaluatedChunk[]): string[] => [
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
];

export const askQuestionWithCorrectiveRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();
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
  const chatScope = await resolveChatScope(userId, payload);
  const retrievalTopK = chatScope.isMultiDocumentScope
    ? answerProfile.wantsDetailedAnswer
      ? MULTI_DOCUMENT_DETAILED_RETRIEVAL_TOP_K
      : MULTI_DOCUMENT_RETRIEVAL_TOP_K
    : answerProfile.wantsDetailedAnswer
    ? DETAILED_RETRIEVAL_TOP_K
    : DEFAULT_RETRIEVAL_TOP_K;
  const processingResponse = (): RagAnswerResult => ({
    answer: DOCUMENT_PROCESSING_MESSAGE,
    mode: "corrective",
    originalQuestion: payload.question,
    rewrittenQuery: payload.question,
    sources: [],
    evaluation: {
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      correctiveAttempted: false,
      isGrounded: false,
      confidenceScore: 0,
      responseTimeMs: Date.now() - startedAt,
      usedFallbackChunks: false,
      relevanceThreshold: RAG_CONFIG.relevanceThreshold,
      fallbackGenerated: true,
      fallbackReason: "document_processing",
      detectedIntent: intent,
      retrievedSections: [],
      answerProfile: answerProfile.profile,
      usedSectionExpansion: false,
      contextChunksUsed: 0,
    },
  });

  if (chatScope.hasProcessingDocument) {
    return processingResponse();
  }

  const rewrittenQuery = await rewriteAcademicQuery(payload.question);

  // Phase 3 retrieval: search with a rewritten academic query, then grade each
  // returned chunk before allowing it into the final answer context.
  const firstPassChunks = chatScope.isMultiDocumentScope
    ? await searchRelevantChunksPerDocument(
        rewrittenQuery,
        chatScope.vectorFilters,
        Math.max(Math.ceil(retrievalTopK / (chatScope.documentIds?.length || 1)), 6),
      )
    : await searchRelevantChunks(
        rewrittenQuery,
        chatScope.vectorFilters,
        retrievalTopK,
      );
  let evaluatedChunks = evaluateRetrievedChunks(
    `${payload.question} ${rewrittenQuery}`,
    firstPassChunks,
    RAG_CONFIG.relevanceThreshold,
  );

  let correctiveAttempted = false;
  let relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  let warning: string | undefined;

  if (
    intent !== "extraction" &&
    relevantChunks.length < RAG_CONFIG.minRelevantChunks
  ) {
    correctiveAttempted = true;
    const stricterQuery = await rewriteAcademicQuery(
      `${payload.question}\nPrevious rewritten query: ${rewrittenQuery}\nFocus on concrete keywords and definitions from the study document.`,
      2,
    );
    const secondPassChunks = chatScope.isMultiDocumentScope
      ? await searchRelevantChunksPerDocument(
          stricterQuery,
          chatScope.vectorFilters,
          Math.max(Math.ceil(retrievalTopK / (chatScope.documentIds?.length || 1)), 6),
        )
      : await searchRelevantChunks(
          stricterQuery,
          chatScope.vectorFilters,
          retrievalTopK,
        );
    const secondEvaluatedChunks = evaluateRetrievedChunks(
      `${payload.question} ${rewrittenQuery} ${stricterQuery}`,
      secondPassChunks,
      RAG_CONFIG.relevanceThreshold,
    );

    evaluatedChunks = dedupeChunks([...evaluatedChunks, ...secondEvaluatedChunks]);
    relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  }

  const contextSelection = answerProfile.wantsDetailedAnswer
    ? await selectContextChunksForQuestion(payload.question, evaluatedChunks, {
        maxChunks: DETAILED_CONTEXT_CHUNK_LIMIT,
      })
    : {
        chunks: relevantChunks,
        usedSectionExpansion: false,
        selectedSectionTitle: undefined,
      };

  if (answerProfile.wantsDetailedAnswer && contextSelection.usedSectionExpansion) {
    evaluatedChunks = dedupeChunks([
      ...evaluatedChunks,
      ...evaluateRetrievedChunks(
        `${payload.question} ${rewrittenQuery}`,
        contextSelection.chunks,
        RAG_CONFIG.relevanceThreshold,
      ),
    ]);
    relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  }

  let answerChunks = selectAnswerChunks(
    answerProfile.wantsDetailedAnswer && contextSelection.usedSectionExpansion
      ? evaluateRetrievedChunks(
          `${payload.question} ${rewrittenQuery}`,
          contextSelection.chunks,
          RAG_CONFIG.relevanceThreshold,
        )
      : relevantChunks,
    intent,
    answerStyle.wantsShortAnswer,
    answerProfile.wantsDetailedAnswer,
  );
  const averageRelevanceScore = calculateAverageRelevance(evaluatedChunks);

  if (answerChunks.length === 0) {
    const fallbackReason =
      evaluatedChunks.length === 0
        ? "no_relevant_chunks_found"
        : "retrieved_chunks_not_relevant_enough";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: evaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      documentTitle: chatScope.documentTitle || evaluatedChunks[0]?.metadata.title,
      subject: chatScope.subject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: "corrective",
      originalQuestion: payload.question,
      rewrittenQuery,
      sources: [],
      evaluation: {
        retrievedChunksCount: evaluatedChunks.length,
        relevantChunksCount: 0,
        averageRelevanceScore,
        correctiveAttempted,
        isGrounded: false,
        confidenceScore: 0,
        responseTimeMs: Date.now() - startedAt,
        usedFallbackChunks: false,
        relevanceThreshold: RAG_CONFIG.relevanceThreshold,
        warning,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        answerProfile: answerProfile.profile,
        usedSectionExpansion: contextSelection.usedSectionExpansion,
        selectedSectionTitle: contextSelection.selectedSectionTitle,
        contextChunksUsed: 0,
        retrievedSections: getRetrievedSections(evaluatedChunks),
      },
    };
  }

  const context = buildContext(answerChunks);
  let answer =
    intent === "extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
          answerProfile: answerProfile.profile,
          subject: chatScope.subject,
          documentTitle: chatScope.documentTitle,
        });
  let grounding = await checkAnswerGrounding(answer, context, {
    intent,
    isMultiDocument: chatScope.isMultiDocumentScope,
  });

  if (!grounding.isGrounded) {
    answer =
      intent === "extraction"
        ? await generateEntityExtractionAnswer(payload.question, context)
        : await generateAnswerFromContext(payload.question, context, true, {
            intent,
            answerProfile: answerProfile.profile,
            subject: chatScope.subject,
            documentTitle: chatScope.documentTitle,
          });
    grounding = await checkAnswerGrounding(answer, context, {
      intent,
      isMultiDocument: chatScope.isMultiDocumentScope,
    });
  }

  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: evaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      documentTitle: chatScope.documentTitle || answerChunks[0]?.metadata.title,
      subject: chatScope.subject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: "corrective",
      originalQuestion: payload.question,
      rewrittenQuery,
      sources: toSources(answerChunks),
      evaluation: {
        retrievedChunksCount: evaluatedChunks.length,
        relevantChunksCount: relevantChunks.length,
        averageRelevanceScore,
        correctiveAttempted,
        isGrounded: false,
        confidenceScore: grounding.confidenceScore,
        responseTimeMs: Date.now() - startedAt,
        usedFallbackChunks: false,
        relevanceThreshold: RAG_CONFIG.relevanceThreshold,
        warning: warning || grounding.warning,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        answerProfile: answerProfile.profile,
        usedSectionExpansion: contextSelection.usedSectionExpansion,
        selectedSectionTitle: contextSelection.selectedSectionTitle,
        contextChunksUsed: answerChunks.length,
        retrievedSections: getRetrievedSections(evaluatedChunks),
      },
    };
  }

  return {
    answer,
    mode: "corrective",
    originalQuestion: payload.question,
    rewrittenQuery,
    sources: toSources(answerChunks),
    evaluation: {
      retrievedChunksCount: evaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      correctiveAttempted,
      isGrounded: grounding.isGrounded,
      confidenceScore: grounding.confidenceScore,
      responseTimeMs: Date.now() - startedAt,
      usedFallbackChunks: false,
      relevanceThreshold: RAG_CONFIG.relevanceThreshold,
      warning: warning || grounding.warning,
      fallbackGenerated: false,
      detectedIntent: intent,
      answerProfile: answerProfile.profile,
      usedSectionExpansion: contextSelection.usedSectionExpansion,
      selectedSectionTitle: contextSelection.selectedSectionTitle,
      contextChunksUsed: answerChunks.length,
      retrievedSections: getRetrievedSections(evaluatedChunks),
    },
  };
};
