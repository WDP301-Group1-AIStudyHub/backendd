import mongoose, { Document, Schema, Types } from "mongoose";

export type UploadSessionStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export type UploadSessionStage =
  | "UPLOADED"
  | "EXTRACTING_TEXT"
  | "CHUNKING"
  | "EMBEDDING"
  | "UPSERTING_VECTOR"
  | "COMPLETED"
  | "FAILED";

export interface IUploadSession extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  versionId: Types.ObjectId;
  status: UploadSessionStatus;
  stage: UploadSessionStage;
  progress: number;
  message?: string;
  errorMessage?: string;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const uploadSessionSchema = new Schema<IUploadSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    versionId: {
      type: Schema.Types.ObjectId,
      ref: "DocumentVersion",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      required: true,
      index: true,
    },
    stage: {
      type: String,
      enum: [
        "UPLOADED",
        "EXTRACTING_TEXT",
        "CHUNKING",
        "EMBEDDING",
        "UPSERTING_VECTOR",
        "COMPLETED",
        "FAILED",
      ],
      default: "UPLOADED",
      required: true,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    errorMessage: {
      type: String,
      trim: true,
      default: "",
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

uploadSessionSchema.index({ userId: 1, createdAt: -1 });
uploadSessionSchema.index({ documentId: 1, versionId: 1 });

export const UploadSession =
  mongoose.models.UploadSession ||
  mongoose.model<IUploadSession>("UploadSession", uploadSessionSchema);
