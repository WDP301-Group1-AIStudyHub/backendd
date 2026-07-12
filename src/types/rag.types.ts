import { Types } from "mongoose";
import { ChatSource } from "./api.types";
import type { AnswerProfile } from "../utils/answerProfile";

export type RagMode = "dr-rag" | "basic" | "corrective" | "agentic";
export type DrRagSelectionStrategy = "cfs-heuristic" | "greedy-all";

// Single-component ablations of the DR-RAG pipeline (internal/benchmark only):
// no-stage2 = static-only retrieval, no-metadata = expanded queries from chunk
// text only, no-grounding = grounding gate disabled, no-cfs = all Stage-2
// candidates admitted up to the context budget.
export type DrRagAblation =
  | "no-stage2"
  | "no-metadata"
  | "no-grounding"
  | "no-cfs";

export interface EvaluatedChunk {
  id: string;
  content: string;
  pineconeScore?: number;
  metadata: {
    documentId: string;
    userId: string;
    subject: string;
    subjectId: string;
    title: string;
    chunkIndex: number;
    heading?: string;
    sectionTitle?: string;
    sectionIndex?: number;
    contentLength?: number;
    section?: string;
    inferredSection?: string;
    semanticSectionLabel?: string;
    outlineNodeId?: string;
    outlinePath?: string;
    outlineLevel?: number;
    outlineType?: string;
    chapterOrdinal?: string;
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
  isGrounded: boolean;
  confidenceScore: number;
  responseTimeMs: number;
  stageOneChunksCount?: number;
  stageTwoChunksCount?: number;
  selectedStaticChunksCount?: number;
  selectedDynamicChunksCount?: number;
  dynamicRetrievalAttempted?: boolean;
  selectionStrategy?: DrRagSelectionStrategy;
  retrievalQueries?: string[];
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
  answerProfile?: AnswerProfile;
  usedSectionExpansion?: boolean;
  selectedSectionTitle?: string;
  contextChunksUsed?: number;
  correctiveAttempted?: boolean;
  ablation?: DrRagAblation;
  // Per-stage wall-clock timings (benchmark instrumentation).
  retrievalLatencyMs?: number;
  stageTwoLatencyMs?: number;
  generationLatencyMs?: number;
  groundingLatencyMs?: number;
  agentLatencyMs?: number;
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
  isGrounded: boolean;
  confidenceScore: number;
  responseTimeMs: number;
  stageOneChunksCount?: number;
  stageTwoChunksCount?: number;
  selectedStaticChunksCount?: number;
  selectedDynamicChunksCount?: number;
  dynamicRetrievalAttempted?: boolean;
  selectionStrategy?: DrRagSelectionStrategy;
  retrievalQueries?: string[];
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
  answerProfile?: AnswerProfile;
  usedSectionExpansion?: boolean;
  selectedSectionTitle?: string;
  contextChunksUsed?: number;
  correctiveAttempted?: boolean;
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
  drRagModeCount: number;
}
