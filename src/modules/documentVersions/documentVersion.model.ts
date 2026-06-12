import mongoose, { Document, Schema, Types } from "mongoose";
import {
  DocumentVersionExtractionStatus,
  DocumentVersionProcessingStage,
  DocumentVersionProcessingStatus,
  DocumentVersionUploadMode,
} from "./documentVersion.types";

export interface IDocumentVersion extends Document {
  documentId: Types.ObjectId;
  versionNumber: number;
  uploadMode: DocumentVersionUploadMode;
  fileUrl: string;
  filePublicId: string;
  fileName: string;
  originalFileName: string;
  storedFileName: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  fileExtension: string;
  extractedText: string;
  extractionStatus: DocumentVersionExtractionStatus;
  extractionError?: string;
  processingStatus: DocumentVersionProcessingStatus;
  processingStage: DocumentVersionProcessingStage;
  processingProgress: number;
  processingError?: string;
  processingStartedAt?: Date | null;
  processingCompletedAt?: Date | null;
  uploadSessionId?: Types.ObjectId;
  totalChunks: number;
  indexedAt?: Date | null;
  uploadedBy: Types.ObjectId;
  uploadReason?: string;
  isActive: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const documentVersionSchema = new Schema<IDocumentVersion>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    uploadMode: {
      type: String,
      enum: ["OVERRIDE", "APPEND"],
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    filePublicId: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    originalFileName: {
      type: String,
      required: true,
    },
    storedFileName: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    fileExtension: {
      type: String,
      required: true,
      default: "",
    },
    extractedText: {
      type: String,
      default: "",
    },
    extractionStatus: {
      type: String,
      enum: ["PENDING", "EXTRACTING", "COMPLETED", "FAILED"],
      default: "PENDING",
      required: true,
    },
    extractionError: {
      type: String,
      trim: true,
      default: "",
    },
    processingStatus: {
      type: String,
      enum: ["PENDING", "PROCESSING", "INDEXED", "FAILED"],
      default: "PENDING",
      required: true,
      index: true,
    },
    processingStage: {
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
    processingProgress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    processingError: {
      type: String,
      trim: true,
      default: "",
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
    processingCompletedAt: {
      type: Date,
      default: null,
    },
    uploadSessionId: {
      type: Schema.Types.ObjectId,
      ref: "UploadSession",
      index: true,
    },
    totalChunks: {
      type: Number,
      default: 0,
      min: 0,
    },
    indexedAt: {
      type: Date,
      default: null,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    uploadReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

documentVersionSchema.index(
  { documentId: 1, versionNumber: 1 },
  { unique: true },
);
documentVersionSchema.index({ documentId: 1, isActive: 1 });
documentVersionSchema.index({ uploadedBy: 1, createdAt: -1 });
documentVersionSchema.index({ versionNumber: 1 });
documentVersionSchema.index({ createdAt: -1 });

export const DocumentVersion =
  mongoose.models.DocumentVersion ||
  mongoose.model<IDocumentVersion>(
    "DocumentVersion",
    documentVersionSchema,
  );
