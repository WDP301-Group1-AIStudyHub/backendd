import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { IUser } from "../types/user.type";
import { User } from "../modules/user/models/user.model";

const JWT_SECRET = process.env.JWT_SECRET || "";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const account = await User.findById(decoded.userId);
    if (!account) return res.status(401).json({ message: "user not found" });
    req.user = account;
    req.uuser = account;
    next();
  } catch (err: any) {
    res.status(401).json({ message: "Invalid Token" });
  }
};
export const checkAdminMiddleWare = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.uuser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!req.uuser.isAdmin) {
    return res.status(403).json({
      message: "Forbidden: Admin privileges required",
    });
  }

  next();
};
export const requireAdmin = [authMiddleware, checkAdminMiddleWare];

declare global {
  namespace Express {
    interface Request {
      uuser?: IUser;
    }
  }
}