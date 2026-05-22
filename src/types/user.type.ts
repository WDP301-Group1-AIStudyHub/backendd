import { ObjectId } from "mongodb";

export interface IUser {
  _id: ObjectId;
  googleId: string;
  userFirstName: string;
  userLastName: string;
  email: string; // unique
  phoneNumber?: string;
  isAdmin: boolean;
  YOB: Date;
  isLocked?: boolean;
  password: string; // hashed
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}
