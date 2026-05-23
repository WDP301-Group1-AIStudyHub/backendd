import { StudyDocument, IDocument } from "../models/document.model";
import {
  DocumentListResponse,
  DocumentResponse,
  SearchDocumentQuery,
  UpdateDocumentRequest,
  UploadDocumentRequest,
} from "../types/api.types";
import { AppError } from "../middlewares/error.middleware";
import {
  deleteCloudinaryFile,
  uploadPdfToCloudinary,
} from "./cloudinary.service";
import { extractPdfText } from "./pdf.service";

export const toDocumentResponse = (document: IDocument): DocumentResponse => ({
  id: document._id.toString(),
  title: document.title,
  description: document.description,
  subject: document.subject,
  fileUrl: document.fileUrl,
  filePublicId: document.filePublicId,
  fileName: document.fileName,
  fileType: document.fileType,
  fileSize: document.fileSize,
  extractedText: document.extractedText,
  uploadedBy: document.uploadedBy,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

export const createDocument = async (
  payload: UploadDocumentRequest,
  file: Express.Multer.File | undefined,
  userId: string,
): Promise<DocumentResponse> => {
  if (!file) {
    throw new AppError("PDF file is required", 400);
  }

  const extractedText = await extractPdfText(file.buffer);
  const cloudinaryResult = await uploadPdfToCloudinary(file);

  const document = await StudyDocument.create({
    title: payload.title,
    description: payload.description,
    subject: payload.subject,
    fileUrl: cloudinaryResult.secure_url,
    filePublicId: cloudinaryResult.public_id,
    fileName: file.originalname,
    fileType: file.mimetype,
    fileSize: file.size,
    extractedText,
    uploadedBy: userId,
  });

  return toDocumentResponse(document);
};

export const getDocumentsByUser = async (
  userId: string,
): Promise<DocumentListResponse> => {
  const documents = await StudyDocument.find({ uploadedBy: userId }).sort({
    createdAt: -1,
  });

  return {
    documents: documents.map(toDocumentResponse),
    total: documents.length,
  };
};

export const getDocumentById = async (
  documentId: string,
  userId: string,
): Promise<DocumentResponse> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    uploadedBy: userId,
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return toDocumentResponse(document);
};

export const updateDocument = async (
  documentId: string,
  userId: string,
  payload: UpdateDocumentRequest,
): Promise<DocumentResponse> => {
  const document = await StudyDocument.findOneAndUpdate(
    { _id: documentId, uploadedBy: userId },
    payload,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  return toDocumentResponse(document);
};

export const deleteDocument = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  const document = await StudyDocument.findOneAndDelete({
    _id: documentId,
    uploadedBy: userId,
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  await deleteCloudinaryFile(document.filePublicId);
};

export const searchDocuments = async (
  userId: string,
  query: SearchDocumentQuery,
): Promise<DocumentListResponse> => {
  const filters: Record<string, unknown> = {
    uploadedBy: userId,
  };

  if (query.subject) {
    filters.subject = new RegExp(query.subject, "i");
  }

  if (query.keyword) {
    filters.$text = { $search: query.keyword };
  }

  const documents = await StudyDocument.find(filters).sort({ createdAt: -1 });

  return {
    documents: documents.map(toDocumentResponse),
    total: documents.length,
  };
};
