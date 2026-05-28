import { EvaluatedChunk } from "../types/rag.types";
import { RetrievedChunk } from "./vector.service";
import { RAG_CONFIG } from "../config/rag.config";

const normalizeTerms = (text: string): string[] => {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3);
};

export const evaluateChunkRelevance = (
  question: string,
  chunk: RetrievedChunk,
  threshold = RAG_CONFIG.relevanceThreshold,
): EvaluatedChunk => {
  // Semantic retrieval remains the primary signal for Vietnamese study docs.
  // Vietnamese accents, spacing, and paraphrases can reduce lexical overlap,
  // so lexical scoring stays secondary and does not use fixed keyword lists.
  const questionTerms = new Set(normalizeTerms(question));
  const chunkTerms = new Set(normalizeTerms(chunk.content));
  const pineconeScore = chunk.pineconeScore ?? 0;

  if (questionTerms.size === 0 || chunkTerms.size === 0) {
    const isRelevant = pineconeScore >= RAG_CONFIG.pineconeRelevanceThreshold;

    console.log("[RAG relevance]", {
      chunkId: chunk.id,
      pineconeScore,
      evaluatorRelevanceScore: 0,
      isRelevant,
      reason: isRelevant
        ? "pinecone_score_above_threshold"
        : "empty_question_or_chunk",
    });

    return {
      ...chunk,
      relevanceScore: 0,
      isRelevant,
      relevanceDecisionReason: isRelevant
        ? "pinecone_score_above_threshold"
        : "empty_question_or_chunk",
    };
  }

  const matchedTerms = [...questionTerms].filter((term) => chunkTerms.has(term));
  const coverageScore = matchedTerms.length / questionTerms.size;
  const densityScore = Math.min(matchedTerms.length / 8, 1);
  const lexicalRelevanceScore = Number(
    (coverageScore * 0.75 + densityScore * 0.25).toFixed(2),
  );
  const relevanceScore = Number(
    Math.max(lexicalRelevanceScore, pineconeScore).toFixed(2),
  );
  const hasAnyQuestionSignal = matchedTerms.length > 0;
  const explicitlyIrrelevant =
    pineconeScore < RAG_CONFIG.pineconeRelevanceThreshold &&
    !hasAnyQuestionSignal;
  const isRelevant =
    !explicitlyIrrelevant &&
    (pineconeScore >= RAG_CONFIG.pineconeRelevanceThreshold ||
      lexicalRelevanceScore >= threshold);
  const relevanceDecisionReason = isRelevant
    ? pineconeScore >= RAG_CONFIG.pineconeRelevanceThreshold
      ? "pinecone_score_above_threshold"
      : "lexical_score_above_threshold"
    : "pinecone_and_lexical_scores_below_threshold";

  console.log("[RAG relevance]", {
    chunkId: chunk.id,
    pineconeScore,
    evaluatorRelevanceScore: lexicalRelevanceScore,
    relevanceScore,
    threshold,
    matchedTerms,
    isRelevant,
    reason: relevanceDecisionReason,
  });

  return {
    ...chunk,
    relevanceScore,
    isRelevant,
    relevanceDecisionReason,
  };
};

export const evaluateRetrievedChunks = (
  question: string,
  chunks: RetrievedChunk[],
  threshold = RAG_CONFIG.relevanceThreshold,
): EvaluatedChunk[] => {
  return chunks.map((chunk) => evaluateChunkRelevance(question, chunk, threshold));
};

export const calculateAverageRelevance = (chunks: EvaluatedChunk[]): number => {
  if (chunks.length === 0) {
    return 0;
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.relevanceScore, 0);

  return Number((total / chunks.length).toFixed(2));
};
