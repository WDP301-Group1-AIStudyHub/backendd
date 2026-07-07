import mongoose, { Document, Schema, Types } from "mongoose";
import { ChatSource } from "../types/api.types";

export type ArtifactType =
  | "FLASHCARD"
  | "QUIZ"
  | "MINDMAP"
  | "REPORT"
  | "DATA_TABLE";
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
      enum: ["FLASHCARD", "QUIZ", "MINDMAP", "REPORT", "DATA_TABLE"],
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

export const Artifact = mongoose.model<IArtifact>("Artifact", artifactSchema);
