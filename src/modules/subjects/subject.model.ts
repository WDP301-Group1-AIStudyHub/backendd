import mongoose, { Document, Schema, Types } from "mongoose";

export interface ISubject extends Document {
  ownerId: Types.ObjectId;
  name: string;
  description?: string;
  color?: string;
  code?: string;
  semester?: string;
  createdAt: Date;
  updatedAt: Date;
}

const subjectSchema = new Schema<ISubject>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    color: {
      type: String,
      trim: true,
      maxlength: 24,
      default: "#2563eb",
    },
    code: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    semester: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

subjectSchema.index({ ownerId: 1, name: 1 }, { unique: true });
subjectSchema.index(
  { ownerId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: {
      code: { $type: "string", $gt: "" },
    },
  },
);

export const Subject =
  mongoose.models.Subject ||
  mongoose.model<ISubject>("Subject", subjectSchema);
