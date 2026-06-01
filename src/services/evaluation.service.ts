import { RagEvaluationLog } from "../models/ragEvaluationLog.model";
import {
  CreateRagEvaluationLogInput,
  RagEvaluationLogResponse,
  RagEvaluationSummaryResponse,
} from "../types/rag.types";

const toEvaluationLogResponse = (
  log: InstanceType<typeof RagEvaluationLog>,
): RagEvaluationLogResponse => ({
  id: log._id.toString(),
  userId: log.userId,
  question: log.question,
  rewrittenQuery: log.rewrittenQuery,
  retrievalMode: log.retrievalMode,
  retrievedChunksCount: log.retrievedChunksCount,
  relevantChunksCount: log.relevantChunksCount,
  averageRelevanceScore: log.averageRelevanceScore,
  correctiveAttempted: log.correctiveAttempted,
  isGrounded: log.isGrounded,
  confidenceScore: log.confidenceScore,
  responseTimeMs: log.responseTimeMs,
  usedFallbackChunks: log.usedFallbackChunks,
  relevanceThreshold: log.relevanceThreshold,
  warning: log.warning,
  fallbackGenerated: log.fallbackGenerated,
  fallbackReason: log.fallbackReason,
  detectedIntent: log.detectedIntent,
  retrievedSections: log.retrievedSections,
  createdAt: log.createdAt,
});

export const createEvaluationLog = async (
  input: CreateRagEvaluationLogInput,
): Promise<void> => {
  await RagEvaluationLog.create(input);
};

export const getEvaluationLogs = async (
  userId: string,
): Promise<RagEvaluationLogResponse[]> => {
  const logs = await RagEvaluationLog.find({ userId }).sort({ createdAt: -1 });

  return logs.map(toEvaluationLogResponse);
};

export const getEvaluationSummary = async (
  userId: string,
): Promise<RagEvaluationSummaryResponse> => {
  const logs = await RagEvaluationLog.find({ userId });

  if (logs.length === 0) {
    return {
      totalQuestions: 0,
      averageRelevanceScore: 0,
      averageConfidenceScore: 0,
      averageResponseTime: 0,
      basicModeCount: 0,
      correctiveModeCount: 0,
    };
  }

  const total = logs.length;
  const sum = logs.reduce(
    (acc, log) => ({
      relevance: acc.relevance + log.averageRelevanceScore,
      confidence: acc.confidence + log.confidenceScore,
      responseTime: acc.responseTime + log.responseTimeMs,
      basic: acc.basic + (log.retrievalMode === "basic" ? 1 : 0),
      corrective: acc.corrective + (log.retrievalMode === "corrective" ? 1 : 0),
    }),
    {
      relevance: 0,
      confidence: 0,
      responseTime: 0,
      basic: 0,
      corrective: 0,
    },
  );

  return {
    totalQuestions: total,
    averageRelevanceScore: Number((sum.relevance / total).toFixed(2)),
    averageConfidenceScore: Number((sum.confidence / total).toFixed(2)),
    averageResponseTime: Number((sum.responseTime / total).toFixed(0)),
    basicModeCount: sum.basic,
    correctiveModeCount: sum.corrective,
  };
};
