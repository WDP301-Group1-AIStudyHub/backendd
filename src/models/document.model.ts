import mongoose, { Document, Schema, Types } from "mongoose";

export interface IDocument extends Document {
  title: string;
  description?: string;
  subject?: string;
  fileUrl: string;
  filePublicId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  extractedText: string;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    fileUrl: {
      type: String,
      required: true,
    },
    filePublicId: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    extractedText: {
      type: String,
      default: "",
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

documentSchema.index({
  title: "text",
  description: "text",
  subject: "text",
  extractedText: "text",
});

export const StudyDocument = mongoose.model<IDocument>(
  "Document",
  documentSchema,
);
