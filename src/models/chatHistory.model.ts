import mongoose, { Document, Schema, Types } from "mongoose";
import { ChatSource } from "../types/api.types";

export interface IChatHistory extends Document {
  userId: Types.ObjectId;
  question: string;
  answer: string;
  sources: ChatSource[];
  documentId?: Types.ObjectId;
  subject?: string;
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
    subject: {
      type: String,
      trim: true,
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
