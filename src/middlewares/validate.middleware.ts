import { NextFunction, Request, Response } from "express";
import { ZodError, ZodType } from "zod";

export const validateRequest =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as {
        body?: unknown;
        query?: Record<string, unknown>;
        params?: Record<string, string>;
      };

      req.body = parsed.body ?? req.body;
      Object.assign(req.query, parsed.query ?? req.query);
      req.params = parsed.params ?? req.params;
      next();
    } catch (error) {
      next(error as ZodError);
    }
  };
