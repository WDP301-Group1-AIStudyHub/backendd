import { Schema, model, Document, Types } from 'mongoose';

export type AiProvider = 'gemini';
export type AiCredentialStatusValue = 'valid' | 'invalid';

export interface IAiCredential extends Document {
  userId: Types.ObjectId;
  provider: AiProvider;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  last4: string;
  status: AiCredentialStatusValue;
  lastValidatedAt?: Date | null;
  lastFailureAt?: Date | null;
  lastFailureReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const aiCredentialSchema = new Schema<IAiCredential>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['gemini'],
      default: 'gemini',
      required: true,
    },
    ciphertext: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    keyVersion: {
      type: Number,
      default: 1,
      required: true,
    },
    last4: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['valid', 'invalid'],
      default: 'valid',
      required: true,
    },
    lastValidatedAt: {
      type: Date,
      default: null,
    },
    lastFailureAt: {
      type: Date,
      default: null,
    },
    lastFailureReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete (ret as any).ciphertext;
        delete (ret as any).iv;
        delete (ret as any).authTag;
        delete (ret as any).keyVersion;
        return ret;
      },
    },
  },
);

export const AiCredential = model<IAiCredential>(
  'AiCredential',
  aiCredentialSchema,
  'aicredentials',
);
