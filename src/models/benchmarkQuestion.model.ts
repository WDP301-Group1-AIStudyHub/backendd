import mongoose, { Document, Schema, Types } from "mongoose";

export type BenchmarkDifficulty = "easy" | "medium" | "hard";

export interface IBenchmarkQuestion extends Document {
  question: string;
  expectedAnswer: string;
  subject?: string;
  documentId?: Types.ObjectId;
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
  sourceStatus?: "ACTIVE" | "DELETED";
  sourceDeletedAt?: Date;
  difficulty: BenchmarkDifficulty;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const benchmarkQuestionSchema = new Schema<IBenchmarkQuestion>(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    expectedAnswer: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
    },
    sourceDocumentId: { type: String, trim: true },
    sourceDocumentTitle: { type: String, trim: true },
    sourceStatus: {
      type: String,
      enum: ["ACTIVE", "DELETED"],
      default: "ACTIVE",
    },
    sourceDeletedAt: { type: Date },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      required: true,
      default: "medium",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const BenchmarkQuestion = mongoose.model<IBenchmarkQuestion>(
  "BenchmarkQuestion",
  benchmarkQuestionSchema,
);
