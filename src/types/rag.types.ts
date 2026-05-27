import { Types } from "mongoose";
import { ChatSource } from "./api.types";

export type RagMode = "basic" | "corrective";

export interface EvaluatedChunk {
  id: string;
  content: string;
  pineconeScore?: number;
  metadata: {
    documentId: string;
    userId: string;
    subject: string;
    title: string;
    chunkIndex: number;
    section?: string;
    inferredSection?: string;
    semanticSectionLabel?: string;
  };
  relevanceScore: number;
  isRelevant: boolean;
  relevanceDecisionReason?: string;
}

export interface AnswerGroundingCheck {
  isGrounded: boolean;
  confidenceScore: number;
  reason?: string;
  warning?: string;
}

export interface RagEvaluation {
  retrievedChunksCount: number;
  relevantChunksCount: number;
  averageRelevanceScore: number;
  correctiveAttempted: boolean;
  isGrounded: boolean;
  confidenceScore: number;
  responseTimeMs: number;
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
}

export interface RagAnswerResult {
  answer: string;
  mode: RagMode;
  originalQuestion: string;
  rewrittenQuery?: string;
  sources: ChatSource[];
  evaluation: RagEvaluation;
}

export interface CreateRagEvaluationLogInput {
  userId: string | Types.ObjectId;
  question: string;
  rewrittenQuery?: string;
  retrievalMode: RagMode;
  retrievedChunksCount: number;
  relevantChunksCount: number;
  averageRelevanceScore: number;
  correctiveAttempted: boolean;
  isGrounded: boolean;
  confidenceScore: number;
  responseTimeMs: number;
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
}

export interface RagEvaluationLogResponse extends CreateRagEvaluationLogInput {
  id: string;
  createdAt: Date;
}

export interface RagEvaluationSummaryResponse {
  totalQuestions: number;
  averageRelevanceScore: number;
  averageConfidenceScore: number;
  averageResponseTime: number;
  basicModeCount: number;
  correctiveModeCount: number;
}
