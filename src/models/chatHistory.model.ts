import mongoose, { Document, Schema, Types } from "mongoose";
import { ChatSource } from "../types/api.types";
import { RagEvaluation, RagMode } from "../types/rag.types";

type ChatScope = "single_document" | "subject_all" | "document_set" | "library_all";

export interface IChatHistory extends Document {
  userId: Types.ObjectId;
  question: string;
  originalQuestion?: string;
  rewrittenQuery?: string;
  answer: string;
  sources: ChatSource[];
  documentId?: Types.ObjectId;
  documentIds?: Types.ObjectId[];
  subjectId?: Types.ObjectId;
  scope?: ChatScope;
  mode?: RagMode;
  evaluation?: RagEvaluation;
  createdAt: Date;
  updatedAt: Date;
}

const chatSourceSchema = new Schema<ChatSource>(
  {
    documentId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    contentPreview: {
      type: String,
      required: true,
    },
    section: {
      type: String,
    },
    inferredSection: {
      type: String,
    },
    semanticSectionLabel: {
      type: String,
    },
    heading: {
      type: String,
    },
    sectionTitle: {
      type: String,
    },
    sectionIndex: {
      type: Number,
    },
    outlineNodeId: {
      type: String,
    },
    outlinePath: {
      type: String,
    },
    outlineLevel: {
      type: Number,
    },
    outlineType: {
      type: String,
    },
    chapterOrdinal: {
      type: String,
    },
    relevanceScore: {
      type: Number,
    },
  },
  { _id: false },
);

const ragEvaluationSchema = new Schema<RagEvaluation>(
  {
    retrievedChunksCount: { type: Number, required: true },
    relevantChunksCount: { type: Number, required: true },
    averageRelevanceScore: { type: Number, required: true },
    correctiveAttempted: { type: Boolean, required: true },
    isGrounded: { type: Boolean, required: true },
    confidenceScore: { type: Number, required: true },
    responseTimeMs: { type: Number, required: true },
    usedFallbackChunks: { type: Boolean },
    relevanceThreshold: { type: Number },
    warning: { type: String },
    fallbackGenerated: { type: Boolean },
    fallbackReason: { type: String },
    detectedIntent: { type: String },
    retrievedSections: { type: [String] },
    answerProfile: { type: String },
    usedSectionExpansion: { type: Boolean },
    selectedSectionTitle: { type: String },
    contextChunksUsed: { type: Number },
  },
  { _id: false },
);

const chatHistorySchema = new Schema<IChatHistory>(
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
    originalQuestion: {
      type: String,
      trim: true,
    },
    rewrittenQuery: {
      type: String,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
    },
    sources: {
      type: [chatSourceSchema],
      default: [],
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
    },
    documentIds: {
      type: [Schema.Types.ObjectId],
      ref: "Document",
      default: undefined,
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
    },
    scope: {
      type: String,
      enum: ["single_document", "subject_all", "document_set", "library_all"],
    },
    mode: {
      type: String,
      enum: ["basic", "corrective"],
      default: "basic",
    },
    evaluation: {
      type: ragEvaluationSchema,
    },
  },
  {
    timestamps: true,
  },
);

export const ChatHistory = mongoose.model<IChatHistory>(
  "ChatHistory",
  chatHistorySchema,
);
