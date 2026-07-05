import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  createDocumentMetadata,
  CreateDocumentRequest,
  emptyTrashDocuments,
  getDocumentDetail,
  getDocuments,
  getDocumentDownloadUrl,
  getStarredDocuments,
  getSharedDocumentsWithUser,
  getTrashDocuments,
  ListDocumentQuery,
  permanentlyDeleteDocument,
  restoreDocumentFromTrash,
  setDocumentStar,
  softDeleteDocument,
  updateSharedDocumentProfile,
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

export const listSharedWithMe = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListDocumentQuery>,
  res: Response,
): Promise<void> => {
  const result = await getSharedDocumentsWithUser(req.authUser!.id, req.query);

  res.status(200).json(result);
});

export const listTrash = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListDocumentQuery>,
  res: Response,
): Promise<void> => {
  const result = await getTrashDocuments(req.authUser!.id, req.query);

  res.status(200).json(result);
});

export const listStarred = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListDocumentQuery>,
  res: Response,
): Promise<void> => {
  const result = await getStarredDocuments(
    req.authUser!.id,
    req.authUser!.role,
    req.query,
  );

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

export const downloadDocument = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getDocumentDownloadUrl(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document download URL fetched successfully",
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

export const editSharedDocumentProfile = asyncHandler(async (
  req: Request<{ id: string }, unknown, { subjectId?: string | null }>,
  res: Response,
): Promise<void> => {
  const data = await updateSharedDocumentProfile(
    req.params.id,
    req.authUser!.id,
    req.body,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Shared document profile updated successfully",
    data,
  });
});

export const restoreDocument = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await restoreDocumentFromTrash(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document restored successfully",
    data,
  });
});

export const deleteDocumentPermanently = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  await permanentlyDeleteDocument(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document permanently deleted successfully",
  });
});

export const emptyTrash = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await emptyTrashDocuments(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Trash emptied successfully",
    data,
  });
});

export const updateDocumentStar = asyncHandler(async (
  req: Request<{ id: string }, unknown, { starred: boolean }>,
  res: Response,
): Promise<void> => {
  const data = await setDocumentStar(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
    req.body.starred,
  );

  sendResponse(res, 200, {
    success: true,
    message: req.body.starred
      ? "Document starred successfully"
      : "Document unstarred successfully",
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
