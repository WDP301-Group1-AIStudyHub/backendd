import { Types } from "mongoose";

export type DocumentVersionUploadMode = "OVERRIDE" | "APPEND";
export type DocumentVersionExtractionStatus =
  | "PENDING"
  | "EXTRACTING"
  | "COMPLETED"
  | "FAILED";
export type DocumentVersionProcessingStatus =
  | "PENDING"
  | "PROCESSING"
  | "INDEXED"
  | "FAILED";
export type DocumentVersionProcessingStage =
  | "UPLOADED"
  | "EXTRACTING_TEXT"
  | "CHUNKING"
  | "EMBEDDING"
  | "UPSERTING_VECTOR"
  | "COMPLETED"
  | "FAILED";

export interface UploadDocumentVersionRequest {
  uploadMode: DocumentVersionUploadMode;
  uploadReason?: string;
  makeActive?: boolean;
}

export interface DocumentVersionResponse {
  id: string;
  documentId: string | Types.ObjectId;
  versionNumber: number;
  uploadMode: DocumentVersionUploadMode;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  fileExtension: string;
  extractionStatus: DocumentVersionExtractionStatus;
  extractionError?: string;
  processingStatus?: DocumentVersionProcessingStatus;
  processingStage?: DocumentVersionProcessingStage;
  processingProgress?: number;
  processingError?: string;
  processingStartedAt?: Date | null;
  processingCompletedAt?: Date | null;
  uploadSessionId?: string;
  totalChunks: number;
  indexedAt?: Date | null;
  isActive: boolean;
  uploadedBy: string | Types.ObjectId;
  uploadReason?: string;
  createdAt: Date;
  updatedAt?: Date;
  extractedText?: string;
}
