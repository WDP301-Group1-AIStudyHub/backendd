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
import {
  addSubjectMember,
  addSubjectTeamMember,
  createDocumentAccess,
  createSubjectTeam,
  deleteSubjectTeam,
  listDocumentAccess,
  listSubjectDocuments,
  listSubjectMembers,
  listSubjectTeams,
  removeSubjectMember,
  removeSubjectTeamMember,
  revokeDocumentAccess,
  updateDocumentAccess,
  updateSubjectMemberRole,
  updateSubjectTeam,
} from "./subjectWorkspace.service";
import {
  SubjectDocumentPermission,
  SubjectGrantType,
  SubjectMemberRole,
} from "./subjectWorkspace.model";

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
  const data = await getSubjectById(
    req.params.id,
    req.authUser!.id,
    req.authUser!.role,
  );

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
  const data = await updateSubject(
    req.params.id,
    req.authUser!.id,
    req.body,
    req.authUser!.role,
  );

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
  await deleteSubject(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Subject deleted successfully",
  });
});

export const listWorkspaceMembers = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await listSubjectMembers(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Subject members fetched successfully",
    data,
  });
});

export const addWorkspaceMember = asyncHandler(async (
  req: Request<{ id: string }, unknown, { email: string; role?: SubjectMemberRole; teamId?: string }>,
  res: Response,
): Promise<void> => {
  const data = await addSubjectMember(
    req.params.id,
    req.authUser!.id,
    req.body,
    req.authUser!.role,
  );

  sendResponse(res, 201, {
    success: true,
    message: "Subject member added successfully",
    data,
  });
});

export const editWorkspaceMemberRole = asyncHandler(async (
  req: Request<{ id: string; memberId: string }, unknown, { role: SubjectMemberRole }>,
  res: Response,
): Promise<void> => {
  const data = await updateSubjectMemberRole(
    req.params.id,
    req.params.memberId,
    req.authUser!.id,
    req.body.role,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Subject member role updated successfully",
    data,
  });
});

export const removeWorkspaceMember = asyncHandler(async (
  req: Request<{ id: string; memberId: string }>,
  res: Response,
): Promise<void> => {
  await removeSubjectMember(
    req.params.id,
    req.params.memberId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Subject member removed successfully",
  });
});

export const listWorkspaceTeams = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await listSubjectTeams(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Subject teams fetched successfully",
    data,
  });
});

export const addWorkspaceTeam = asyncHandler(async (
  req: Request<{ id: string }, unknown, { name: string; description?: string }>,
  res: Response,
): Promise<void> => {
  const data = await createSubjectTeam(
    req.params.id,
    req.authUser!.id,
    req.body,
    req.authUser!.role,
  );

  sendResponse(res, 201, {
    success: true,
    message: "Subject team created successfully",
    data,
  });
});

export const editWorkspaceTeam = asyncHandler(async (
  req: Request<{ id: string; teamId: string }, unknown, { name?: string; description?: string }>,
  res: Response,
): Promise<void> => {
  const data = await updateSubjectTeam(
    req.params.id,
    req.params.teamId,
    req.authUser!.id,
    req.body,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Subject team updated successfully",
    data,
  });
});

export const removeWorkspaceTeam = asyncHandler(async (
  req: Request<{ id: string; teamId: string }>,
  res: Response,
): Promise<void> => {
  await deleteSubjectTeam(
    req.params.id,
    req.params.teamId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Subject team deleted successfully",
  });
});

export const addWorkspaceTeamMember = asyncHandler(async (
  req: Request<{ id: string; teamId: string }, unknown, { userId: string }>,
  res: Response,
): Promise<void> => {
  const data = await addSubjectTeamMember(
    req.params.id,
    req.params.teamId,
    req.authUser!.id,
    req.body.userId,
    req.authUser!.role,
  );

  sendResponse(res, 201, {
    success: true,
    message: "Team member added successfully",
    data,
  });
});

export const removeWorkspaceTeamMember = asyncHandler(async (
  req: Request<{ id: string; teamId: string; userId: string }>,
  res: Response,
): Promise<void> => {
  const data = await removeSubjectTeamMember(
    req.params.id,
    req.params.teamId,
    req.params.userId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Team member removed successfully",
    data,
  });
});

export const listWorkspaceDocuments = asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> => {
  const data = await listSubjectDocuments(req.params.id, req.authUser!.id, req.authUser!.role);

  sendResponse(res, 200, {
    success: true,
    message: "Subject documents fetched successfully",
    data,
  });
});

export const listWorkspaceDocumentAccess = asyncHandler(async (
  req: Request<{ id: string; documentId: string }>,
  res: Response,
): Promise<void> => {
  const data = await listDocumentAccess(
    req.params.id,
    req.params.documentId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document access grants fetched successfully",
    data,
  });
});

export const addWorkspaceDocumentAccess = asyncHandler(async (
  req: Request<
    { id: string; documentId: string },
    unknown,
    { granteeType: SubjectGrantType; granteeId: string; permission: SubjectDocumentPermission }
  >,
  res: Response,
): Promise<void> => {
  const data = await createDocumentAccess(
    req.params.id,
    req.params.documentId,
    req.authUser!.id,
    req.body,
    req.authUser!.role,
  );

  sendResponse(res, 201, {
    success: true,
    message: "Document access grant saved successfully",
    data,
  });
});

export const editWorkspaceDocumentAccess = asyncHandler(async (
  req: Request<
    { id: string; documentId: string; grantId: string },
    unknown,
    { permission: SubjectDocumentPermission }
  >,
  res: Response,
): Promise<void> => {
  const data = await updateDocumentAccess(
    req.params.id,
    req.params.documentId,
    req.params.grantId,
    req.authUser!.id,
    req.body.permission,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document access grant updated successfully",
    data,
  });
});

export const removeWorkspaceDocumentAccess = asyncHandler(async (
  req: Request<{ id: string; documentId: string; grantId: string }>,
  res: Response,
): Promise<void> => {
  await revokeDocumentAccess(
    req.params.id,
    req.params.documentId,
    req.params.grantId,
    req.authUser!.id,
    req.authUser!.role,
  );

  sendResponse(res, 200, {
    success: true,
    message: "Document access grant revoked successfully",
  });
});
