import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  createSubject,
  CreateSubjectRequest,
  deleteSubject,
  getSubjectById,
  getSubjectsByUser,
  ListSubjectQuery,
  updateSubject,
  UpdateSubjectRequest,
} from "./subject.service";

export const createUserSubject = asyncHandler(async (
  req: Request<unknown, unknown, CreateSubjectRequest>,
  res: Response,
): Promise<void> => {
  const data = await createSubject(req.authUser!.id, req.body);

  sendResponse(res, 201, {
    success: true,
    message: "Subject created successfully",
    data,
  });
});

export const listUserSubjects = asyncHandler(async (
  req: Request<unknown, unknown, unknown, ListSubjectQuery>,
  res: Response,
): Promise<void> => {
  const data = await getSubjectsByUser(req.authUser!.id, req.query);

  sendResponse(res, 200, {
    success: true,
    message: "Subjects fetched successfully",
    data,
  });
});

export const getUserSubject = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await getSubjectById(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Subject fetched successfully",
    data,
  });
});

export const editUserSubject = asyncHandler(async (
  req: Request<{ id: string }, unknown, UpdateSubjectRequest>,
  res: Response,
): Promise<void> => {
  const data = await updateSubject(req.params.id, req.authUser!.id, req.body);

  sendResponse(res, 200, {
    success: true,
    message: "Subject updated successfully",
    data,
  });
});

export const removeUserSubject = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  await deleteSubject(req.params.id, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Subject deleted successfully",
  });
});
