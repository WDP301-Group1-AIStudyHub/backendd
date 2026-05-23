import { NextFunction, Request, RequestHandler, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";

type AsyncController<P, ResBody, ReqBody, ReqQuery> = (
  req: Request<P, ResBody, ReqBody, ReqQuery>,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export const asyncHandler =
  <
    P = ParamsDictionary,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = ParsedQs,
  >(
    controller: AsyncController<P, ResBody, ReqBody, ReqQuery>,
  ): RequestHandler<P, ResBody, ReqBody, ReqQuery> =>
  (req, res, next): void => {
    controller(req, res, next).catch(next);
  };
