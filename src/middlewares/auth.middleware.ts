import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error.middleware";
import { User } from "../models/user.model";

interface TokenPayload {
  id: string;
  email: string;
  role: "user" | "admin";
}

export const authMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AppError("Authorization token is required", 401));
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "change-this-secret",
    ) as TokenPayload;

    const user = await User.findById(decoded.id).select("+isActive +banReason");
    if (!user) {
      return next(new AppError("User no longer exists", 401));
    }

    if (user.isActive === false) {
      return next(new AppError(`Your account has been banned. Reason: ${user.banReason || 'Contact support'}`, 401));
    }

    req.authUser = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    return next();
  } catch (error) {
    return next(new AppError("Invalid or expired token", 401));
  }
};

export const isAdminMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.authUser) {
    return next(new AppError("Not authenticated", 401));
  }

  if (req.authUser.role !== "admin") {
    return next(new AppError("Forbidden: Admin access required", 403));
  }

  return next();
};
