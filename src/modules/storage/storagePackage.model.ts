import mongoose, { Document, Schema } from "mongoose";

export interface IStoragePackage extends Document {
  code: string;
  name: string;
  capacityBytes: number;
  priceVnd: number;
  description: string;
  features: string[];
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  highlight: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const storagePackageSchema = new Schema<IStoragePackage>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    capacityBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    priceVnd: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    features: {
      type: [String],
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    // Exactly one package carries isDefault. New users are provisioned onto it.
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    highlight: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

storagePackageSchema.index({ isActive: 1, sortOrder: 1 });
storagePackageSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export const StoragePackage =
  mongoose.models.StoragePackage ||
  mongoose.model<IStoragePackage>("StoragePackage", storagePackageSchema);
