import { AskQuestionRequest, ChatSource } from "../types/api.types";
import { EvaluatedChunk, RagAnswerResult } from "../types/rag.types";
import { generateAnswerFromContext } from "./groq.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";
import {
  calculateAverageRelevance,
  evaluateRetrievedChunks,
} from "./relevance.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { searchRelevantChunks } from "./vector.service";

const INSUFFICIENT_CONTEXT_ANSWER =
  "Tôi không tìm thấy thông tin này trong tài liệu đã upload.";

const MIN_RELEVANT_CHUNKS = 3;
const RELEVANCE_THRESHOLD = 0.65;

const buildContext = (chunks: EvaluatedChunk[]): string => {
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}, chunk ${chunk.metadata.chunkIndex}\n${chunk.content}`,
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
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
    relevanceScore: chunk.relevanceScore,
  }));
};

export const askQuestionWithCorrectiveRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();
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

  if (relevantChunks.length < MIN_RELEVANT_CHUNKS) {
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

  const averageRelevanceScore = calculateAverageRelevance(evaluatedChunks);

  if (relevantChunks.length < MIN_RELEVANT_CHUNKS) {
    return {
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      mode: "corrective",
      originalQuestion: payload.question,
      rewrittenQuery,
      sources: toSources(relevantChunks),
      evaluation: {
        retrievedChunksCount: evaluatedChunks.length,
        relevantChunksCount: relevantChunks.length,
        averageRelevanceScore,
        correctiveAttempted,
        isGrounded: true,
        confidenceScore: relevantChunks.length === 0 ? 0 : 0.5,
        responseTimeMs: Date.now() - startedAt,
      },
    };
  }

  const context = buildContext(relevantChunks);
  let answer = await generateAnswerFromContext(payload.question, context);
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer = await generateAnswerFromContext(payload.question, context, true);
    grounding = await checkAnswerGrounding(answer, context);
  }

  return {
    answer: answer || INSUFFICIENT_CONTEXT_ANSWER,
    mode: "corrective",
    originalQuestion: payload.question,
    rewrittenQuery,
    sources: toSources(relevantChunks),
    evaluation: {
      retrievedChunksCount: evaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      correctiveAttempted,
      isGrounded: grounding.isGrounded,
      confidenceScore: grounding.confidenceScore,
      responseTimeMs: Date.now() - startedAt,
    },
  };
};
