import { Response } from "express";
import { ApiResponse } from "../types/api.types";

export const sendResponse = <T>(
  res: Response,
  statusCode: number,
  payload: ApiResponse<T>,
): void => {
  res.status(statusCode).json(payload);
};
