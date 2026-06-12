import { Types } from "mongoose";
import { RagEvaluation, RagMode } from "./rag.types";

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export type UserRole = "user" | "admin";

export interface RegisterRequest {
  fullName: string;
  email: string;
  password: string;
  avatar?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UpdateProfileRequest {
  fullName?: string;
  avatar?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface UserResponse {
  id: string;
  fullName: string;
  email: string;
  avatar?: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  user: UserResponse;
  accessToken: string;
}

export interface UploadDocumentRequest {
  title: string;
  description?: string;
  subject?: string;
  subjectId: string;
  visibility?: DocumentVisibility;
}

export interface UpdateDocumentRequest {
  title?: string;
  description?: string;
  subject?: string;
  subjectId?: string;
  visibility?: DocumentVisibility;
  status?: Exclude<DocumentStatus, "DELETED">;
}

export interface SearchDocumentQuery {
  keyword?: string;
  subject?: string;
  subjectId?: string;
  visibility?: DocumentVisibility;
}

export interface ListDocumentQuery {
  subject?: string;
  subjectId?: string;
  keyword?: string;
  visibility?: DocumentVisibility;
  status?: Exclude<DocumentStatus, "DELETED">;
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

export type DocumentVisibility = "PUBLIC" | "PRIVATE";
export type DocumentStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

export interface DocumentResponse {
  _id?: string;
  id: string;
  ownerId?: string | Types.ObjectId;
  title: string;
  description?: string;
  subject?: string;
  subjectId?: string | Types.ObjectId | SubjectSummaryResponse;
  visibility?: DocumentVisibility;
  status?: DocumentStatus;
  totalViews?: number;
  totalDownloads?: number;
  currentVersionId?: string | Types.ObjectId;
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
  extractionStatus?: "COMPLETED" | "FAILED";
  extractionError?: string;
  uploadedBy: string | Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubjectRequest {
  name: string;
  code?: string;
  description?: string;
  color?: string;
}

export interface UpdateSubjectRequest {
  name?: string;
  code?: string;
  description?: string;
  color?: string;
}

export interface ListSubjectQuery {
  page?: string;
  limit?: string;
  search?: string;
}

export interface SubjectResponse {
  _id: string;
  ownerId?: string | Types.ObjectId;
  name: string;
  code?: string;
  description?: string;
  color?: string;
  userId: string | Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubjectSummaryResponse {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  color?: string;
}

export interface DocumentListItemResponse {
  _id: string;
  title: string;
  description?: string;
  subject?: SubjectSummaryResponse | null;
  visibility?: DocumentVisibility;
  status?: DocumentStatus;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface DocumentListResponse {
  documents: DocumentResponse[];
  total: number;
}

export interface PaginatedDocumentListResponse {
  items: DocumentListItemResponse[];
  pagination: PaginationResponse;
}

export interface ReindexDocumentResponse {
  documentId: string;
  deletedVectorCount: number;
  chunkingStrategy?: "heading-based" | "fixed-size-fallback";
  chunksCreated: number;
  detectedSections: string[];
  upsertedVectorCount: number;
}

export interface DebugDocumentChunkResponse {
  chunksCount: number;
  chunkingStrategy: "heading-based" | "fixed-size-fallback";
  chunks: Array<{
    chunkIndex: number;
    sectionIndex: number;
    heading: string | null;
    sectionTitle: string;
    contentLength: number;
    contentPreview: string;
  }>;
}

export interface AskQuestionRequest {
  question: string;
  documentId?: string;
  subject?: string;
  subjectId?: string;
  mode?: RagMode;
}

export interface ChatSource {
  documentId: string;
  title: string;
  chunkIndex: number;
  section?: string;
  inferredSection?: string;
  semanticSectionLabel?: string;
  heading?: string;
  sectionTitle?: string;
  sectionIndex?: number;
  contentPreview: string;
  relevanceScore?: number;
}

export interface AskQuestionResponse {
  answer: string;
  mode?: RagMode;
  originalQuestion?: string;
  rewrittenQuery?: string;
  sources: ChatSource[];
  evaluation?: RagEvaluation;
}

export interface ChatHistoryResponse {
  id: string;
  userId: string | Types.ObjectId;
  question: string;
  originalQuestion?: string;
  rewrittenQuery?: string;
  answer: string;
  sources: ChatSource[];
  documentId?: string | Types.ObjectId;
  subject?: string;
  subjectId?: string | Types.ObjectId;
  mode?: RagMode;
  evaluation?: RagEvaluation;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatHistoryListResponse {
  histories: ChatHistoryResponse[];
  total: number;
}

export type BenchmarkDifficulty = "easy" | "medium" | "hard";
export type BenchmarkWinner = "basic" | "corrective" | "tie";

export interface BenchmarkQuestionRequest {
  question: string;
  expectedAnswer: string;
  subject?: string;
  documentId?: string;
  difficulty: BenchmarkDifficulty;
}

export interface BenchmarkQuestionResponse {
  id: string;
  question: string;
  expectedAnswer: string;
  subject?: string;
  documentId?: string | Types.ObjectId;
  difficulty: BenchmarkDifficulty;
  createdBy: string | Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface BenchmarkEvaluationScore {
  answerCorrectness: number;
  faithfulness: number;
  relevance: number;
  completeness: number;
  overallScore: number;
  explanation: string;
}

export interface BenchmarkResultResponse {
  id: string;
  benchmarkQuestionId: string | Types.ObjectId;
  question: string;
  expectedAnswer: string;
  basicAnswer: string;
  correctiveAnswer: string;
  basicEvaluation: BenchmarkEvaluationScore;
  correctiveEvaluation: BenchmarkEvaluationScore;
  winner: BenchmarkWinner;
  createdBy: string | Types.ObjectId;
  createdAt: Date;
}

export interface BenchmarkSummaryResponse {
  totalRuns: number;
  basicAverageScore: number;
  correctiveAverageScore: number;
  correctiveWinRate: number;
  basicWinRate: number;
  tieRate: number;
  averageFaithfulnessImprovement: number;
  averageCorrectnessImprovement: number;
}
