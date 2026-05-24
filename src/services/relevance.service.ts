import { EvaluatedChunk } from "../types/rag.types";
import { RetrievedChunk } from "./vector.service";

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
  threshold = 0.65,
): EvaluatedChunk => {
  const questionTerms = new Set(normalizeTerms(question));
  const chunkTerms = new Set(normalizeTerms(chunk.content));

  if (questionTerms.size === 0 || chunkTerms.size === 0) {
    return {
      ...chunk,
      relevanceScore: 0,
      isRelevant: false,
    };
  }

  const matchedTerms = [...questionTerms].filter((term) => chunkTerms.has(term));
  const coverageScore = matchedTerms.length / questionTerms.size;
  const densityScore = Math.min(matchedTerms.length / 8, 1);
  const relevanceScore = Number(
    (coverageScore * 0.75 + densityScore * 0.25).toFixed(2),
  );

  return {
    ...chunk,
    relevanceScore,
    isRelevant: relevanceScore >= threshold,
  };
};

export const evaluateRetrievedChunks = (
  question: string,
  chunks: RetrievedChunk[],
  threshold = 0.65,
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
