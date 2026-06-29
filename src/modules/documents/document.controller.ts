import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  createDocumentMetadata,
  CreateDocumentRequest,
  getDocumentDetail,
  getDocuments,
  ListDocumentQuery,
  softDeleteDocument,
  updateDocumentMetadata,
  UpdateDocumentRequest,
} from "./document.service";

export const createDocument = asyncHandler(async (
  req: Request<unknown, unknown, CreateDocumentRequest>,
  res: Response,
): Promise<void> => {
  const data = await createDocumentMetadata(req.authUser!.id, req.body);

  sendResponse(res, 201, {
    success: true,
    message: "Document created successfully",
    data,
  });
});

export const listDocuments = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListDocumentQuery>,
  res: Response,
): Promise<void> => {
  const result = await getDocuments(req.authUser!.id, req.authUser!.role, req.query);

  res.status(200).json(result);
});

export const getDocument = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getDocumentDetail(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Document fetched successfully",
    data,
  });
});

export const editDocument = asyncHandler(async (
  req: Request<{ id: string }, unknown, UpdateDocumentRequest>,
  res: Response,
): Promise<void> => {
  const data = await updateDocumentMetadata(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
    req.body,
  );

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
  await softDeleteDocument(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Document deleted successfully",
  });
});
