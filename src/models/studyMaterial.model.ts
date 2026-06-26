import mongoose, { Document, Schema, Types } from "mongoose";

export type MaterialType = "MCQ" | "FLASHCARD";
export type MaterialStatus = "PENDING" | "GENERATING" | "COMPLETED" | "FAILED";

export interface IMcqItem {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface IFlashcardItem {
  front: string;
  back: string;
}

export interface IStudyMaterial extends Document {
  title: string;
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  type: MaterialType;
  status: MaterialStatus;
  error?: string;
  items: (IMcqItem | IFlashcardItem)[];
  topicsCovered?: string[];
  followUpTopics?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const studyMaterialSchema = new Schema<IStudyMaterial>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    topicsCovered: {
      type: [String],
      default: [],
    },
    followUpTopics: {
      type: [String],
      default: [],
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["MCQ", "FLASHCARD"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "GENERATING", "COMPLETED", "FAILED"],
      required: true,
      default: "PENDING",
      index: true,
    },
    error: {
      type: String,
      trim: true,
    },
    items: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    } as any,
  },
  {
    timestamps: true,
  }
);

export const StudyMaterial = mongoose.model<IStudyMaterial>(
  "StudyMaterial",
  studyMaterialSchema
);
