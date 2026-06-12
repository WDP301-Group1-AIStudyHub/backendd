import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  activateDocumentVersion,
  deleteDocumentVersion,
  getDocumentVersionDetail,
  getDocumentVersions,
  reindexDocumentVersion,
  uploadDocumentVersion,
} from "./documentVersion.service";
import { UploadDocumentVersionRequest } from "./documentVersion.types";

export const uploadVersion = asyncHandler(async (
  req: Request<{ documentId: string }, unknown, UploadDocumentVersionRequest>,
  res: Response,
): Promise<void> => {
  const data = await uploadDocumentVersion(
    req.params.documentId,
    req.authUser!.id,
    req.body,
    req.file,
  );

  sendResponse(res, 201, {
    success: true,
    message: "Document uploaded and indexed successfully",
    data,
  });
});

export const listVersions = asyncHandler(async (
  req: Request<
    { documentId: string },
    unknown,
    unknown,
    { page?: string; limit?: string }
  >,
  res: Response,
): Promise<void> => {
  const result = await getDocumentVersions(
    req.params.documentId,
    req.authUser!.id,
    req.query,
  );

  res.status(200).json({
    success: true,
    message: "Document versions fetched successfully",
    ...result,
  });
});

export const getVersion = asyncHandler(async (
  req: Request<
    { documentId: string; versionId: string },
    unknown,
    unknown,
    { includeText?: string }
  >,
  res: Response,
): Promise<void> => {
  const data = await getDocumentVersionDetail(
    req.params.documentId,
    req.params.versionId,
    req.authUser!.id,
    req.query,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document version fetched successfully",
    data,
  });
});

export const activateVersion = asyncHandler(async (
  req: Request<{ documentId: string; versionId: string }>,
  res: Response,
): Promise<void> => {
  const data = await activateDocumentVersion(
    req.params.documentId,
    req.params.versionId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document version activated successfully",
    data,
  });
});

export const reindexVersion = asyncHandler(async (
  req: Request<{ documentId: string; versionId: string }>,
  res: Response,
): Promise<void> => {
  const data = await reindexDocumentVersion(
    req.params.documentId,
    req.params.versionId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document version reindexed successfully",
    data,
  });
});

export const removeVersion = asyncHandler(async (
  req: Request<{ documentId: string; versionId: string }>,
  res: Response,
): Promise<void> => {
  await deleteDocumentVersion(
    req.params.documentId,
    req.params.versionId,
    req.authUser!.id,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document version deleted successfully",
  });
});
