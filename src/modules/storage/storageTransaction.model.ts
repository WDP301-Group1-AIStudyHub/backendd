import mongoose, { Document, Schema, Types } from "mongoose";

export type StorageTransactionStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type StoragePaymentProvider = "PAYOS" | "VNPAY" | "MOCK";

export type StorageClientPlatform = "WEB" | "MOBILE";

export interface IStorageTransaction extends Document {
  userId: Types.ObjectId;
  packageId: Types.ObjectId;
  packageSnapshot: {
    code: string;
    name: string;
    capacityBytes: number;
    priceVnd: number;
  };
  amountVnd: number;
  currency: string;
  provider: StoragePaymentProvider;
  status: StorageTransactionStatus;
  orderRef: string;
  providerOrderCode?: number | null;
  clientPlatform: StorageClientPlatform;
  clientReturnUrl: string;
  paymentUrl: string;
  paymentLinkId: string;
  providerTxnRef: string;
  bankCode: string;
  providerResponseCode: string;
  ipnReceivedAt?: Date | null;
  ipnRawQuery?: Record<string, unknown> | null;
  settledBy?: "RETURN" | "IPN" | "WEBHOOK" | "INLINE" | null;
  completedAt?: Date | null;
  failureReason: string;
  previousPackageId?: Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const storageTransactionSchema = new Schema<IStorageTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    packageId: {
      type: Schema.Types.ObjectId,
      ref: "StoragePackage",
      required: true,
    },
    // Frozen at order time so a later price/capacity edit never rewrites history.
    packageSnapshot: {
      code: { type: String, default: "" },
      name: { type: String, default: "" },
      capacityBytes: { type: Number, default: 0 },
      priceVnd: { type: Number, default: 0 },
    },
    amountVnd: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "VND",
    },
    provider: {
      type: String,
      enum: ["PAYOS", "VNPAY", "MOCK"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
      required: true,
      index: true,
    },
    // vnp_TxnRef. Unique so a replayed callback can never create a second order.
    orderRef: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    providerOrderCode: {
      type: Number,
      index: true,
      unique: true,
      sparse: true,
    },
    // Chosen at order creation, never read back from the gateway response, so
    // the return redirect target always comes from our own database.
    clientPlatform: {
      type: String,
      enum: ["WEB", "MOBILE"],
      default: "WEB",
      required: true,
    },
    clientReturnUrl: {
      type: String,
      default: "",
      maxlength: 2048,
    },
    paymentUrl: {
      type: String,
      default: "",
    },
    paymentLinkId: {
      type: String,
      default: "",
    },
    providerTxnRef: {
      type: String,
      default: "",
    },
    bankCode: {
      type: String,
      default: "",
    },
    providerResponseCode: {
      type: String,
      default: "",
    },
    ipnReceivedAt: {
      type: Date,
      default: null,
    },
    ipnRawQuery: {
      type: Schema.Types.Mixed,
      default: null,
    },
    // Which path actually closed the order. Both the browser return and the
    // server-to-server IPN can settle it, so ipnReceivedAt alone cannot tell
    // you whether the IPN URL registered with the gateway is correct.
    settledBy: {
      type: String,
      enum: ["RETURN", "IPN", "WEBHOOK", "INLINE", null],
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: "",
    },
    previousPackageId: {
      type: Schema.Types.ObjectId,
      ref: "StoragePackage",
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

storageTransactionSchema.index({ userId: 1, createdAt: -1 });
storageTransactionSchema.index({ status: 1, expiresAt: 1 });

export const StorageTransaction =
  mongoose.models.StorageTransaction ||
  mongoose.model<IStorageTransaction>(
    "StorageTransaction",
    storageTransactionSchema,
  );
