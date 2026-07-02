import mongoose, { Document, Schema, Types } from "mongoose";

export interface IDocumentStar extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  createdAt: Date;
}

const documentStarSchema = new Schema<IDocumentStar>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    versionKey: false,
  },
);

documentStarSchema.index({ userId: 1, documentId: 1 }, { unique: true });
documentStarSchema.index({ userId: 1, createdAt: -1 });

export const DocumentStar =
  mongoose.models.DocumentStar ||
  mongoose.model<IDocumentStar>("DocumentStar", documentStarSchema);
