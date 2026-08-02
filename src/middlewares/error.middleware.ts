import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import mongoose from "mongoose";
import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;
  // Machine-readable code and structured payload so clients can render a
  // specific message instead of parsing prose. Both are optional; every
  // existing throw leaves them undefined and serializes exactly as before.
  code?: string;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
};

export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error("ERROR HANDLER:", {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });

  let statusCode = 500;
  let message = "Internal server error";
  let code: string | undefined;
  let details: Record<string, unknown> | undefined;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code;
    details = error.details;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    message = error.issues.map((issue) => issue.message).join(", ");
  } else if (error instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = "Invalid resource id";
  } else if (error instanceof TokenExpiredError) {
    statusCode = 401;
    message = "Access token expired";
  } else if (error instanceof JsonWebTokenError) {
    statusCode = 401;
    message = "Invalid access token";
  } else if (error.name === "MongoServerError") {
    statusCode = 409;
    message = "Duplicate value already exists";
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
    debug: {
      name: error.name,
      message: error.message,
    },
  });
};
