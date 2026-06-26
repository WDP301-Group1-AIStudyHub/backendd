import mongoose, { Document, Schema, Types } from "mongoose";
import { RagMode } from "../types/rag.types";

export type ChatThreadStatus = "ACTIVE" | "ARCHIVED";
export type ChatThreadScope =
  | "single_document"
  | "subject_all"
  | "document_set"
  | "library_all";

export interface IChatThread extends Document {
  ownerId: Types.ObjectId;
  title: string;
  status: ChatThreadStatus;
  lastMessageAt: Date;
  messageCount: number;
  scope?: ChatThreadScope;
  subjectId?: Types.ObjectId;
  documentId?: Types.ObjectId;
  documentIds?: Types.ObjectId[];
  mode?: RagMode;
  createdAt: Date;
  updatedAt: Date;
}

const chatThreadSchema = new Schema<IChatThread>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED"],
      default: "ACTIVE",
      required: true,
      index: true,
    },
    lastMessageAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    messageCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    scope: {
      type: String,
      enum: ["single_document", "subject_all", "document_set", "library_all"],
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
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
    mode: {
      type: String,
      enum: ["basic", "corrective"],
      default: "basic",
    },
  },
  {
    timestamps: true,
  },
);

chatThreadSchema.index({ ownerId: 1, status: 1, lastMessageAt: -1 });

export const ChatThread =
  mongoose.models.ChatThread ||
  mongoose.model<IChatThread>("ChatThread", chatThreadSchema);
