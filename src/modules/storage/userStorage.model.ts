import mongoose, { Document, Schema, Types } from "mongoose";

export interface IUserStorage extends Document {
  userId: Types.ObjectId;
  packageId: Types.ObjectId;
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  activatedAt: Date;
  lastReconciledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userStorageSchema = new Schema<IUserStorage>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    packageId: {
      type: Schema.Types.ObjectId,
      ref: "StoragePackage",
      required: true,
    },
    // Denormalized copy of the package capacity at activation time, so an admin
    // editing a package never silently resizes existing subscribers, and so the
    // atomic reserve stays a single-document operation with no $lookup.
    quotaBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    // Cached counter maintained with atomic $inc. The aggregate in
    // storage.service.ts (computeActualUsedBytes) remains the source of truth.
    usedBytes: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Bytes promised to in-flight uploads that have not reached Cloudinary yet.
    reservedBytes: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    activatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastReconciledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export const UserStorage =
  mongoose.models.UserStorage ||
  mongoose.model<IUserStorage>("UserStorage", userStorageSchema);
