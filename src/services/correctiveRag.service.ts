import { AskQuestionRequest, ChatSource } from "../types/api.types";
import { EvaluatedChunk, RagAnswerResult } from "../types/rag.types";
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
import { detectQuestionIntent, QuestionIntent } from "../utils/ragIntent";
import {
  detectAnswerStyle,
  getInsufficientContextAnswer,
} from "../utils/answerStyle";

const FALLBACK_WARNING =
  "Used fallback top retrieved chunks because relevance evaluator rejected all chunks.";

const MIN_RELEVANT_CHUNKS = 3;
const RELEVANCE_THRESHOLD = 0.35;
const DEFAULT_CONTEXT_CHUNK_LIMIT = 5;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 3;

const buildContext = (chunks: EvaluatedChunk[]): string => {
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}, section ${chunk.metadata.section}, chunk ${chunk.metadata.chunkIndex}\n${chunk.content}`,
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
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
    relevanceScore: chunk.relevanceScore,
  }));
};

const getFallbackChunks = (chunks: EvaluatedChunk[]): EvaluatedChunk[] => {
  return [...chunks]
    .sort((a, b) => (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0))
    .slice(0, 3)
    .map((chunk) => ({
      ...chunk,
      isRelevant: true,
      relevanceDecisionReason: "fallback_top_retrieved_chunk",
    }));
};

const selectAnswerChunks = (
  chunks: EvaluatedChunk[],
  intent: QuestionIntent,
  wantsShortAnswer: boolean,
): EvaluatedChunk[] => {
  const maxChunks =
    intent === "entity_extraction" || wantsShortAnswer
      ? FOCUSED_CONTEXT_CHUNK_LIMIT
      : DEFAULT_CONTEXT_CHUNK_LIMIT;

  // Document-type independent context selection: rank by retrieval/evaluation
  // relevance only, without assuming any document category or domain.
  return [...chunks]
    .filter((chunk) => chunk.relevanceScore >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxChunks);
};

const getRetrievedSections = (chunks: EvaluatedChunk[]): string[] => [
  ...new Set(chunks.map((chunk) => chunk.metadata.section)),
];

export const askQuestionWithCorrectiveRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();
  const intent = detectQuestionIntent(payload.question);
  const answerStyle = detectAnswerStyle(payload.question);
  const insufficientContextAnswer = getInsufficientContextAnswer(
    answerStyle.language,
  );
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
    RELEVANCE_THRESHOLD,
  );

  let correctiveAttempted = false;
  let relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  let usedFallbackChunks = false;
  let warning: string | undefined;

  if (
    intent !== "entity_extraction" &&
    relevantChunks.length < MIN_RELEVANT_CHUNKS
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
      RELEVANCE_THRESHOLD,
    );

    evaluatedChunks = dedupeChunks([...evaluatedChunks, ...secondEvaluatedChunks]);
    relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant);
  }

  if (evaluatedChunks.length > 0 && relevantChunks.length === 0) {
    usedFallbackChunks = true;
    warning = FALLBACK_WARNING;
    relevantChunks = getFallbackChunks(evaluatedChunks);

    console.log("[RAG relevance fallback]", {
      warning,
      selectedChunkIds: relevantChunks.map((chunk) => chunk.id),
      selectedPineconeScores: relevantChunks.map(
        (chunk) => chunk.pineconeScore ?? 0,
      ),
    });
  }

  const candidateAnswerChunks =
    relevantChunks.length > 0 ? relevantChunks : getFallbackChunks(evaluatedChunks);
  let answerChunks = selectAnswerChunks(
    candidateAnswerChunks,
    intent,
    answerStyle.wantsShortAnswer,
  );
  if (answerChunks.length === 0 && candidateAnswerChunks.length > 0) {
    usedFallbackChunks = true;
    warning = warning || FALLBACK_WARNING;
    answerChunks = getFallbackChunks(candidateAnswerChunks);
  }
  const averageRelevanceScore = calculateAverageRelevance(evaluatedChunks);

  if (answerChunks.length === 0) {
    return {
      answer: insufficientContextAnswer,
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
        usedFallbackChunks,
        relevanceThreshold: RELEVANCE_THRESHOLD,
        warning,
        detectedIntent: intent,
        retrievedSections: getRetrievedSections(evaluatedChunks),
      },
    };
  }

  const context = buildContext(answerChunks);
  let answer =
    intent === "entity_extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
        });
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer =
      intent === "entity_extraction"
        ? await generateEntityExtractionAnswer(payload.question, context)
        : await generateAnswerFromContext(payload.question, context, true, {
            intent,
          });
    grounding = await checkAnswerGrounding(answer, context);
  }

  return {
    answer: answer || insufficientContextAnswer,
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
      usedFallbackChunks,
      relevanceThreshold: RELEVANCE_THRESHOLD,
      warning: warning || grounding.warning,
      detectedIntent: intent,
      retrievedSections: getRetrievedSections(evaluatedChunks),
    },
  };
};
