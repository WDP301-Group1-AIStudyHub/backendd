import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error.middleware";

interface TokenPayload {
  id: string;
  email: string;
  role: "user" | "admin";
}

export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new AppError("Authorization token is required", 401));
  }

  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(
    token,
    process.env.JWT_SECRET || "change-this-secret",
  ) as TokenPayload;

  req.authUser = {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
  };

  return next();
};
