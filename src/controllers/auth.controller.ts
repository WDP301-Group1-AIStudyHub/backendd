import { Request, Response } from "express";
import {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from "../types/api.types";
import {
  getUserById,
  loginUser,
  registerUser,
  updateUserProfile,
} from "../services/auth.service";
import {
  changePassword as changePasswordService,
  requestPasswordReset,
  resetPassword as resetPasswordService,
} from "../services/passwordReset.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { ActivityLogService } from "../services/activityLog.service";
import { getIpAddress } from "../utils/getIp";

export const register = asyncHandler(async (
  req: Request<unknown, unknown, RegisterRequest>,
  res: Response,
): Promise<void> => {
  const data = await registerUser(req.body);

  await ActivityLogService.log({
    userId: data.user.id,
    action: "USER_REGISTER",
    entityType: "User",
    entityId: data.user.id,
    details: { email: data.user.email },
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"],
  });

  sendResponse(res, 201, {
    success: true,
    message: "Registered successfully",
    data,
  });
});

export const login = asyncHandler(async (
  req: Request<unknown, unknown, LoginRequest>,
  res: Response,
): Promise<void> => {
  const data = await loginUser(req.body.email, req.body.password);

  await ActivityLogService.log({
    userId: data.user.id,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: data.user.id,
    details: { email: data.user.email },
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"],
  });

  sendResponse(res, 200, {
    success: true,
    message: "Logged in successfully",
    data,
  });
});

export const logout = async (_req: Request, res: Response): Promise<void> => {
  sendResponse(res, 200, {
    success: true,
    message: "Logged out successfully. Remove the token on the client.",
  });
};

export const me = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getUserById(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Current user fetched successfully",
    data,
  });
});

export const updateProfile = asyncHandler(async (
  req: Request<unknown, unknown, UpdateProfileRequest>,
  res: Response,
): Promise<void> => {
  const data = await updateUserProfile(req.authUser!.id, req.body);

  sendResponse(res, 200, {
    success: true,
    message: "Profile updated successfully",
    data,
  });
});

export const forgotPassword = asyncHandler(async (
  req: Request<unknown, unknown, ForgotPasswordRequest>,
  res: Response,
): Promise<void> => {
  await requestPasswordReset(req.body.email);

  // Identical response whether or not the email exists — never let this
  // route reveal which emails have accounts.
  sendResponse(res, 200, {
    success: true,
    message:
      "If the email exists, password reset instructions have been sent.",
    data: {
      email: req.body.email,
    },
  });
});

export const resetPassword = asyncHandler(async (
  req: Request<unknown, unknown, { token: string; password: string }>,
  res: Response,
): Promise<void> => {
  await resetPasswordService(req.body.token, req.body.password);

  sendResponse(res, 200, {
    success: true,
    message: "Password reset successfully. You can now sign in.",
  });
});

export const changePassword = asyncHandler(async (
  req: Request<unknown, unknown, { currentPassword: string; newPassword: string }>,
  res: Response,
): Promise<void> => {
  await changePasswordService(
    req.authUser!.id,
    req.body.currentPassword,
    req.body.newPassword,
  );

  await ActivityLogService.log({
    userId: req.authUser!.id,
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: req.authUser!.id,
    details: {},
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"],
  });

  sendResponse(res, 200, {
    success: true,
    message: "Password changed successfully.",
  });
});
