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
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const register = asyncHandler(async (
  req: Request<unknown, unknown, RegisterRequest>,
  res: Response,
): Promise<void> => {
  const data = await registerUser(req.body);

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

export const forgotPassword = async (
  req: Request<unknown, unknown, ForgotPasswordRequest>,
  res: Response,
): Promise<void> => {
  sendResponse(res, 200, {
    success: true,
    message:
      "If the email exists, password reset instructions will be sent later.",
    data: {
      email: req.body.email,
    },
  });
};
