import mongoose, { Document, Schema, Types } from "mongoose";
import type { DocumentSharePermission } from "./documentShare.model";

export interface IDocumentShareInvitation extends Document {
  documentId: Types.ObjectId;
  email: string;
  permission: DocumentSharePermission;
  sharedBy: Types.ObjectId;
  tokenHash: string;
  tokenCiphertext?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const documentShareInvitationSchema = new Schema<IDocumentShareInvitation>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    permission: {
      type: String,
      enum: ["VIEW", "EDIT"],
      required: true,
    },
    sharedBy: {
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

documentShareInvitationSchema.index(
  { documentId: 1, email: 1 },
  { unique: true },
);

export const DocumentShareInvitation =
  mongoose.models.DocumentShareInvitation ||
  mongoose.model<IDocumentShareInvitation>(
    "DocumentShareInvitation",
    documentShareInvitationSchema,
  );
