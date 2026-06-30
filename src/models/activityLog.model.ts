import mongoose, { Document, Schema, Types } from "mongoose";

export type ActivityAction =
  | "USER_REGISTER"
  | "USER_LOGIN"
  | "DOCUMENT_UPLOAD"
  | "DOCUMENT_DELETE"
  | "SYSTEM_ERROR"
  | "SETTINGS_UPDATE"
  | "OTHER";

export type EntityType = "User" | "Document" | "System" | "Other";

export interface IActivityLog extends Document {
  userId?: Types.ObjectId;
  action: ActivityAction;
  entityType: EntityType;
  entityId?: Types.ObjectId;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      required: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for faster querying in admin dashboard
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

export const ActivityLog = mongoose.model<IActivityLog>(
  "ActivityLog",
  activityLogSchema,
);
