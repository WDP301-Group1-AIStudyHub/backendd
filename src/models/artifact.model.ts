import mongoose, { Document, Schema, Types } from "mongoose";
import { ChatSource } from "../types/api.types";

export type ArtifactType =
  | "FLASHCARD"
  | "QUIZ"
  | "MINDMAP"
  | "REPORT"
  | "DATA_TABLE"
  | "SUMMARY";
export type ArtifactStatus = "PENDING" | "GENERATING" | "COMPLETED" | "FAILED";

export interface IMindmapNode {
  label: string;
  children?: IMindmapNode[];
}

// Content shapes per artifact type. FLASHCARD/QUIZ items are intentionally
// identical to IFlashcardItem/IMcqItem so the frontend player components
// (FlashcardStudy, McqQuiz) render them unchanged.
export type ArtifactContent =
  | { items: { front: string; back: string }[] }
  | {
      items: {
        question: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      }[];
    }
  | { root: IMindmapNode }
  | { markdown: string }
  | { columns: string[]; rows: string[][] };

export interface IArtifact extends Document {
  userId: Types.ObjectId;
  threadId?: Types.ObjectId;
  type: ArtifactType;
  status: ArtifactStatus;
  title: string;
  instructions?: string;
  content?: ArtifactContent;
  sourceDocumentIds: Types.ObjectId[];
  // SUMMARY only: the document this is the summary of. Separate from
  // sourceDocumentIds because it is the cache key — a unique index on it is
  // what makes "one summary per document" hold under concurrent requests.
  summaryDocumentId?: Types.ObjectId;
  subjectId?: Types.ObjectId;
  scope?: string;
  sources?: ChatSource[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const artifactSchema = new Schema<IArtifact>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    threadId: {
      type: Schema.Types.ObjectId,
      ref: "ChatThread",
    },
    type: {
      type: String,
      enum: ["FLASHCARD", "QUIZ", "MINDMAP", "REPORT", "DATA_TABLE", "SUMMARY"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "GENERATING", "COMPLETED", "FAILED"],
      required: true,
      default: "PENDING",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    instructions: {
      type: String,
      trim: true,
    },
    content: {
      type: Schema.Types.Mixed,
    },
    sourceDocumentIds: {
      type: [Schema.Types.ObjectId],
      ref: "Document",
      default: [],
    },
    summaryDocumentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
    },
    scope: {
      type: String,
      trim: true,
    },
    sources: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    error: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

artifactSchema.index({ userId: 1, threadId: 1 });

// One summary per document, enforced by the database rather than by a
// read-then-write in the service: two rapid presses of the Summarize button
// would otherwise both miss the cache and both spend a prompt from the quota.
// Partial, so the millions of non-SUMMARY artifacts (all with the field
// absent) do not collide with each other on null.
artifactSchema.index(
  { summaryDocumentId: 1 },
  {
    unique: true,
    partialFilterExpression: { summaryDocumentId: { $exists: true } },
  }
);

export const Artifact = mongoose.model<IArtifact>("Artifact", artifactSchema);
