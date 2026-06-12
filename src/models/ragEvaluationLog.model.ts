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
  correctiveAttempted: boolean;
  isGrounded: boolean;
  confidenceScore: number;
  responseTimeMs: number;
  usedFallbackChunks?: boolean;
  relevanceThreshold?: number;
  warning?: string;
  fallbackGenerated?: boolean;
  fallbackReason?: string;
  detectedIntent?: string;
  retrievedSections?: string[];
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
      enum: ["basic", "corrective"],
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
    correctiveAttempted: {
      type: Boolean,
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
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const RagEvaluationLog = mongoose.model<IRagEvaluationLog>(
  "RagEvaluationLog",
  ragEvaluationLogSchema,
);
