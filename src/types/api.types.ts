import { Types } from "mongoose";

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
