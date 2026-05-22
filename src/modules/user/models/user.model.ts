import mongoose, { Document, Schema } from "mongoose";
import { IUser } from "../../../types/user.type";
const userSchema = new Schema<IUser>(
  {
    userFirstName: { type: String, required: true },
    userLastName: { type: String, required: true },
    googleId: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: Number, require: true, unique: true, sparse: true },
    password: { type: String, require: true },
   
    YOB: { type: Date, requrie: true },
  

    isAdmin: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },

    // currency: { type: String },
    // isEmailVerified: { type: Boolean },
    avatar: { type: String },
  },
  {
    timestamps: true,
  },
);
export const User = mongoose.model<IUser>("User", userSchema);
