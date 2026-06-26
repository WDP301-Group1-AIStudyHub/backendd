import mongoose, { Document, Schema, Types } from "mongoose";
import type { DocumentOutlineNode } from "../../utils/documentOutline";

export type DocumentVisibility = "PUBLIC" | "PRIVATE";
export type DocumentStatus = "ACTIVE" | "ARCHIVED" | "DELETED";
export type ExtractionStatus = "COMPLETED" | "FAILED";
export type DocumentChunkingStrategy = "heading-based" | "fixed-size-fallback";

export interface IDocument extends Document {
  ownerId: Types.ObjectId;
  subjectId: Types.ObjectId;
  title: string;
  description?: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  totalViews: number;
  totalDownloads: number;
  currentVersionId?: Types.ObjectId;
  totalVersions: number;
  totalChunks: number;
  chunkingStrategy?: DocumentChunkingStrategy;
  detectedSections?: string[];
  documentOutline?: DocumentOutlineNode[];
  chapterCount?: number;
  partCount?: number;
  sectionCount?: number;
  lastIndexedAt?: Date | null;
  deletedAt?: Date | null;
  fileUrl?: string;
  filePublicId?: string;
  fileName?: string;
  fileType?: string;
  originalFileName?: string;
  storedFileName?: string;
  fileExtension?: string;
  mimeType?: string;
  fileSize?: number;
  extractedText?: string;
  extractionStatus?: ExtractionStatus;
  extractionError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    visibility: {
      type: String,
      enum: ["PUBLIC", "PRIVATE"],
      default: "PRIVATE",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED", "DELETED"],
      default: "ACTIVE",
      required: true,
      index: true,
    },
    totalViews: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDownloads: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentVersionId: {
      type: Schema.Types.ObjectId,
      ref: "DocumentVersion",
    },
    totalVersions: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalChunks: {
      type: Number,
      default: 0,
      min: 0,
    },
    chunkingStrategy: {
      type: String,
      enum: ["heading-based", "fixed-size-fallback"],
    },
    detectedSections: {
      type: [String],
      default: [],
    },
    documentOutline: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    chapterCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    partCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    sectionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastIndexedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    fileUrl: String,
    filePublicId: String,
    fileName: String,
    fileType: String,
    originalFileName: String,
    storedFileName: String,
    fileExtension: {
      type: String,
      default: "",
    },
    mimeType: String,
    fileSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    extractedText: {
      type: String,
      default: "",
    },
    extractionStatus: {
      type: String,
      enum: ["COMPLETED", "FAILED"],
      default: "COMPLETED",
    },
    extractionError: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

documentSchema.index({ ownerId: 1, subjectId: 1 });
documentSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
documentSchema.index({ visibility: 1, status: 1, createdAt: -1 });
documentSchema.index({
  title: "text",
  description: "text",
});

export const StudyDocument =
  mongoose.models.Document ||
  mongoose.model<IDocument>("Document", documentSchema);
