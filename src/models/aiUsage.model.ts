import { Schema, model, Document, Types } from 'mongoose';

export interface IAiUsage extends Document {
  userId: Types.ObjectId;
  period: string;
  messageCount: number;
  degradedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const aiUsageSchema = new Schema<IAiUsage>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    period: {
      type: String,
      required: true,
    },
    messageCount: {
      type: Number,
      default: 0,
      required: true,
    },
    degradedCount: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index for atomic per-month upserts
aiUsageSchema.index({ userId: 1, period: 1 }, { unique: true });

export const AiUsage = model<IAiUsage>('AiUsage', aiUsageSchema, 'aiusages');
