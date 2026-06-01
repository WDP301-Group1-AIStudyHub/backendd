import { AskQuestionRequest, ChatSource } from "../types/api.types";
import { EvaluatedChunk, RagAnswerResult } from "../types/rag.types";
import { StudyDocument } from "../models/document.model";
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
import { searchRelevantChunks } from "./vector.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import {
  classifyQuestionIntent,
  SemanticQuestionIntent,
} from "./intentClassifier.service";
import { RAG_CONFIG } from "../config/rag.config";
import { generateFallbackAnswer } from "./fallbackAnswer.service";

const DEFAULT_CONTEXT_CHUNK_LIMIT = 5;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 3;

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
): EvaluatedChunk[] => {
  const maxChunks =
    intent === "extraction" || wantsShortAnswer
      ? FOCUSED_CONTEXT_CHUNK_LIMIT
      : DEFAULT_CONTEXT_CHUNK_LIMIT;

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
  const intent = intentClassification.intent;
  const answerStyle = detectAnswerStyle(payload.question);
  let documentTitle: string | undefined;
  let documentSubject = payload.subject;

  if (payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: payload.documentId,
      uploadedBy: userId,
    });

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    documentTitle = document.title;
    documentSubject = document.subject || documentSubject;
  }

  const rewrittenQuery = await rewriteAcademicQuery(payload.question);

  // Phase 3 retrieval: search with a rewritten academic query, then grade each
  // returned chunk before allowing it into the final answer context.
  const firstPassChunks = await searchRelevantChunks(
    rewrittenQuery,
    {
      userId,
      documentId: payload.documentId,
      subject: payload.documentId ? undefined : payload.subject,
    },
    8,
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
    const secondPassChunks = await searchRelevantChunks(
      stricterQuery,
      {
        userId,
        documentId: payload.documentId,
        subject: payload.documentId ? undefined : payload.subject,
      },
      8,
    );
    const secondEvaluatedChunks = evaluateRetrievedChunks(
      `${payload.question} ${rewrittenQuery} ${stricterQuery}`,
      secondPassChunks,
      RAG_CONFIG.relevanceThreshold,
    );

    evaluatedChunks = dedupeChunks([...evaluatedChunks, ...secondEvaluatedChunks]);
    relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  }

  let answerChunks = selectAnswerChunks(
    relevantChunks,
    intent,
    answerStyle.wantsShortAnswer,
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
      documentTitle: documentTitle || evaluatedChunks[0]?.metadata.title,
      subject: documentSubject,
      reason: fallbackReason,
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
        });
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer =
      intent === "extraction"
        ? await generateEntityExtractionAnswer(payload.question, context)
        : await generateAnswerFromContext(payload.question, context, true, {
            intent,
          });
    grounding = await checkAnswerGrounding(answer, context);
  }

  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: evaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      documentTitle: documentTitle || answerChunks[0]?.metadata.title,
      subject: documentSubject,
      reason: fallbackReason,
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
      retrievedSections: getRetrievedSections(evaluatedChunks),
    },
  };
};
