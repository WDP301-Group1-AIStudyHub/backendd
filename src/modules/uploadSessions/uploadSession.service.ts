import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { UploadSession, IUploadSession } from "./uploadSession.model";

export interface UploadSessionResponse {
  uploadSessionId: string;
  documentId: string | Types.ObjectId;
  versionId: string | Types.ObjectId;
  status: string;
  stage: string;
  progress: number;
  message?: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toUploadSessionResponse = (
  session: IUploadSession,
): UploadSessionResponse => ({
  uploadSessionId: session._id.toString(),
  documentId: session.documentId,
  versionId: session.versionId,
  status: session.status,
  stage: session.stage,
  progress: session.progress,
  message: session.message,
  errorMessage: session.errorMessage || null,
  completedAt: session.completedAt,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

export const getUploadSessionById = async (
  uploadSessionId: string,
  userId: string,
  role?: string,
): Promise<UploadSessionResponse> => {
  const session = await UploadSession.findOne({
    _id: uploadSessionId,
    ...(role === "admin" ? {} : { userId }),
  });

  if (!session) {
    throw new AppError("Upload session not found", 404);
  }

  return toUploadSessionResponse(session);
};
