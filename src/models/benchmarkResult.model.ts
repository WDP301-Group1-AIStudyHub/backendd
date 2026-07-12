import mongoose, { Document, Schema, Types } from "mongoose";
import { BenchmarkEvaluationScore } from "../types/api.types";
import { DrRagAblation, RagEvaluation, RagMode } from "../types/rag.types";

export interface IBenchmarkResult extends Document {
  benchmarkQuestionId: Types.ObjectId;
  question: string;
  expectedAnswer: string;
  answer: string;
  evaluation: BenchmarkEvaluationScore;
  mode?: RagMode;
  ablation?: DrRagAblation;
  telemetry?: RagEvaluation;
  retrievalMetrics?: {
    recall5: number;
    recall10: number;
    mrr: number;
    hit5: number;
  };
  costMetrics?: {
    promptTokens: number;
    completionTokens: number;
    embeddingTokens: number;
    embeddingCalls: number;
    usdCost: number;
  };
  exactMatch?: boolean;
  f1Score?: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const benchmarkEvaluationSchema = new Schema<BenchmarkEvaluationScore>(
  {
    answerCorrectness: { type: Number, required: true },
    faithfulness: { type: Number, required: true },
    relevance: { type: Number, required: true },
    completeness: { type: Number, required: true },
    overallScore: { type: Number, required: true },
    explanation: { type: String, required: true },
  },
  { _id: false },
);

const retrievalMetricsSchema = new Schema(
  {
    recall5: { type: Number, required: true },
    recall10: { type: Number, required: true },
    mrr: { type: Number, required: true },
    hit5: { type: Number, required: true },
  },
  { _id: false },
);

const costMetricsSchema = new Schema(
  {
    promptTokens: { type: Number, required: true },
    completionTokens: { type: Number, required: true },
    embeddingTokens: { type: Number, required: true },
    embeddingCalls: { type: Number, required: true },
    usdCost: { type: Number, required: true },
  },
  { _id: false },
);

const benchmarkResultSchema = new Schema<IBenchmarkResult>(
  {
    benchmarkQuestionId: {
      type: Schema.Types.ObjectId,
      ref: "BenchmarkQuestion",
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
    },
    expectedAnswer: {
      type: String,
      required: true,
    },
    answer: {
      type: String,
      required: true,
    },
    evaluation: {
      type: benchmarkEvaluationSchema,
      required: true,
    },
    mode: {
      type: String,
      enum: ["basic", "corrective", "dr-rag", "agentic"],
    },
    ablation: {
      type: String,
      enum: ["no-stage2", "no-metadata", "no-grounding", "no-cfs"],
    },
    telemetry: {
      type: Schema.Types.Mixed,
    },
    retrievalMetrics: {
      type: retrievalMetricsSchema,
    },
    costMetrics: {
      type: costMetricsSchema,
    },
    exactMatch: {
      type: Boolean,
    },
    f1Score: {
      type: Number,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const BenchmarkResult = mongoose.model<IBenchmarkResult>(
  "BenchmarkResult",
  benchmarkResultSchema,
);
