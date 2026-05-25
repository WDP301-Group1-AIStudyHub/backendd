import { Types } from "mongoose";
import { DocumentSection } from "../utils/documentSection";
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
}

export interface UpdateDocumentRequest {
  title?: string;
  description?: string;
  subject?: string;
}

export interface SearchDocumentQuery {
  keyword?: string;
  subject?: string;
}

export interface DocumentResponse {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  fileUrl: string;
  filePublicId: string;
  fileName: string;
  fileType: string;
  originalFileName: string;
  storedFileName: string;
  fileExtension: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  uploadedBy: string | Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentListResponse {
  documents: DocumentResponse[];
  total: number;
}

export interface ReindexDocumentResponse {
  documentId: string;
  deletedVectorCount: number;
  chunksCreated: number;
  detectedSections: string[];
  upsertedVectorCount: number;
}

export interface AskQuestionRequest {
  question: string;
  documentId?: string;
  subject?: string;
  mode?: RagMode;
}

export interface ChatSource {
  documentId: string;
  title: string;
  chunkIndex: number;
  section?: DocumentSection;
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
