import mongoose, { Document, Schema, Types } from "mongoose";

export type DocumentSharePermission = "VIEW" | "EDIT";

export interface IDocumentShare extends Document {
  documentId: Types.ObjectId;
  sharedWithUserId: Types.ObjectId;
  permission: DocumentSharePermission;
  sharedBy: Types.ObjectId;
  personalSubjectId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const documentShareSchema = new Schema<IDocumentShare>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    sharedWithUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    personalSubjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

documentShareSchema.index(
  { documentId: 1, sharedWithUserId: 1 },
  { unique: true },
);
documentShareSchema.index({ sharedWithUserId: 1, personalSubjectId: 1 });

export const DocumentShare =
  mongoose.models.DocumentShare ||
  mongoose.model<IDocumentShare>("DocumentShare", documentShareSchema);
