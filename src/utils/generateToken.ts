import jwt from "jsonwebtoken";
import { StringValue } from "ms";
import { IUser } from "../models/user.model";

export const generateAccessToken = (user: IUser): string => {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || "change-this-secret",
    {
      expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as StringValue,
    },
  );
};

export default generateAccessToken;
