import { Request, Response } from "express";
import {
  ListDocumentQuery,
  SearchDocumentQuery,
  UpdateDocumentRequest,
  UploadDocumentRequest,
} from "../types/api.types";
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  getDocumentSubjectsByUser,
  getDocumentsByUser,
  reindexUserDocument,
  searchDocuments,
  updateDocument,
} from "../services/document.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const uploadDocument = asyncHandler(async (
  req: Request<unknown, unknown, UploadDocumentRequest>,
  res: Response,
): Promise<void> => {
  const data = await createDocument(req.body, req.file, req.authUser!.id);

  sendResponse(res, 201, {
    success: true,
    message: "Document uploaded successfully",
    data,
  });
  
});

export const listDocuments = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListDocumentQuery>,
  res: Response,
): Promise<void> => {
  const data = await getDocumentsByUser(req.authUser!.id, req.query);

  sendResponse(res, 200, {
    success: true,
    message: "Get documents successfully",
    data,
  });
});

export const listDocumentSubjects = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getDocumentSubjectsByUser(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Get subjects successfully",
    data,
  });
});

export const getDocument = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getDocumentById(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Document fetched successfully",
    data,
  });
});

export const reindexDocument = asyncHandler(async (
  req: Request<{ documentId: string }>,
  res: Response,
): Promise<void> => {
  const data = await reindexUserDocument(
    req.params.documentId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document reindexed successfully",
    data,
  });
});

export const editDocument = asyncHandler(async (
  req: Request<{ id: string }, unknown, UpdateDocumentRequest>,
  res: Response,
): Promise<void> => {
  const data = await updateDocument(req.params.id, req.authUser!.id, req.body);

  sendResponse(res, 200, {
    success: true,
    message: "Document updated successfully",
    data,
  });
});

export const removeDocument = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  await deleteDocument(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Document deleted successfully",
  });
});

export const searchUserDocuments = asyncHandler(async (
  req: Request<unknown, unknown, unknown, SearchDocumentQuery>,
  res: Response,
): Promise<void> => {
  const data = await searchDocuments(req.authUser!.id, req.query);

  sendResponse(res, 200, {
    success: true,
    message: "Documents searched successfully",
    data,
  });
});
