import mongoose, { Document, Schema, Types } from "mongoose";
import { RagMode } from "../types/rag.types";

export interface IRagEvaluationLog extends Document {
  userId: Types.ObjectId;
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
  selectionStrategy?: string;
  retrievalQueries?: string[];
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
  answerProfile?: string;
  usedSectionExpansion?: boolean;
  selectedSectionTitle?: string;
  contextChunksUsed?: number;
  createdAt: Date;
}

const ragEvaluationLogSchema = new Schema<IRagEvaluationLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    rewrittenQuery: {
      type: String,
      trim: true,
    },
    retrievalMode: {
      type: String,
      enum: ["dr-rag"],
      required: true,
      index: true,
    },
    retrievedChunksCount: {
      type: Number,
      required: true,
    },
    relevantChunksCount: {
      type: Number,
      required: true,
    },
    averageRelevanceScore: {
      type: Number,
      required: true,
    },
    isGrounded: {
      type: Boolean,
      required: true,
    },
    confidenceScore: {
      type: Number,
      required: true,
    },
    responseTimeMs: {
      type: Number,
      required: true,
    },
    stageOneChunksCount: {
      type: Number,
    },
    stageTwoChunksCount: {
      type: Number,
    },
    selectedStaticChunksCount: {
      type: Number,
    },
    selectedDynamicChunksCount: {
      type: Number,
    },
    dynamicRetrievalAttempted: {
      type: Boolean,
    },
    selectionStrategy: {
      type: String,
    },
    retrievalQueries: {
      type: [String],
    },
    usedFallbackChunks: {
      type: Boolean,
    },
    relevanceThreshold: {
      type: Number,
    },
    warning: {
      type: String,
    },
    fallbackGenerated: {
      type: Boolean,
    },
    fallbackReason: {
      type: String,
    },
    detectedIntent: {
      type: String,
    },
    retrievedSections: {
      type: [String],
    },
    answerProfile: {
      type: String,
    },
    usedSectionExpansion: {
      type: Boolean,
    },
    selectedSectionTitle: {
      type: String,
    },
    contextChunksUsed: {
      type: Number,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const RagEvaluationLog = mongoose.model<IRagEvaluationLog>(
  "RagEvaluationLog",
  ragEvaluationLogSchema,
);
