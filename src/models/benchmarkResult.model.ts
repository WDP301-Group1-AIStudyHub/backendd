import mongoose, { Document, Schema, Types } from "mongoose";
import { BenchmarkEvaluationScore } from "../types/api.types";

export type BenchmarkWinner = "basic" | "corrective" | "tie";

export interface IBenchmarkResult extends Document {
  benchmarkQuestionId: Types.ObjectId;
  question: string;
  expectedAnswer: string;
  basicAnswer: string;
  correctiveAnswer: string;
  basicEvaluation: BenchmarkEvaluationScore;
  correctiveEvaluation: BenchmarkEvaluationScore;
  winner: BenchmarkWinner;
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
    basicAnswer: {
      type: String,
      required: true,
    },
    correctiveAnswer: {
      type: String,
      required: true,
    },
    basicEvaluation: {
      type: benchmarkEvaluationSchema,
      required: true,
    },
    correctiveEvaluation: {
      type: benchmarkEvaluationSchema,
      required: true,
    },
    winner: {
      type: String,
      enum: ["basic", "corrective", "tie"],
      required: true,
      index: true,
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
