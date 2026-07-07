import mongoose, { Document, Schema, Types } from "mongoose";
import type { SubjectMemberRole } from "./subjectWorkspace.model";

export interface ISubjectMemberInvitation extends Document {
  subjectId: Types.ObjectId;
  teamId?: Types.ObjectId;
  email: string;
  role: SubjectMemberRole;
  invitedBy: Types.ObjectId;
  tokenHash: string;
  tokenCiphertext?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const subjectMemberInvitationSchema = new Schema<ISubjectMemberInvitation>(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "SubjectTeam",
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["OWNER", "ADMIN", "MEMBER"],
      default: "MEMBER",
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    tokenCiphertext: {
      type: String,
      select: false,
    },
    tokenIv: {
      type: String,
      select: false,
    },
    tokenAuthTag: {
      type: String,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

subjectMemberInvitationSchema.index(
  { subjectId: 1, email: 1, teamId: 1 },
  { unique: true },
);

export const SubjectMemberInvitation =
  mongoose.models.SubjectMemberInvitation ||
  mongoose.model<ISubjectMemberInvitation>(
    "SubjectMemberInvitation",
    subjectMemberInvitationSchema,
  );
