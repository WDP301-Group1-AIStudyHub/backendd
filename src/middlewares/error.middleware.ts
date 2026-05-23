import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import mongoose from "mongoose";
import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
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
  let statusCode = 500;
  let message = "Internal server error";

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
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
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};
