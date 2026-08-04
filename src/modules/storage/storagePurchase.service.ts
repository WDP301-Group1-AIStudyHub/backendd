import crypto from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import {
  buildPaginationResponse,
  paginate,
  PaginationInput,
} from "../../common/utils/pagination.util";
import { StoragePackage, IStoragePackage } from "./storagePackage.model";
import { UserStorage } from "./userStorage.model";
import {
  IStorageTransaction,
  StorageClientPlatform,
  StorageTransaction,
} from "./storageTransaction.model";
import {
  buildUserStorageResponse,
  ensureUserStorage,
  reconcileUserStorage,
  toPackageResponse,
} from "./storage.service";
import { getPaymentProvider } from "./payment";
import { formatVnpayDate } from "./payment/vnpay.provider";
import { getPublicApiBaseUrl } from "../../services/publicAppUrl.service";

const DEFAULT_TTL_MINUTES = 15;

const getOrderTtlMinutes = (): number => {
  const parsed = Number.parseInt(
    process.env.STORAGE_ORDER_TTL_MINUTES || "",
    10,
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MINUTES;
};

/** Internal, gateway-neutral reference kept stable in APIs and history. */
export const generateOrderRef = (): string =>
  `SP${formatVnpayDate(new Date())}${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;

export const generateProviderOrderCode = (): number =>
  Number(`${Date.now()}`.slice(-8) + crypto.randomInt(10, 99));

export const toTransactionResponse = (transaction: IStorageTransaction) => ({
  id: transaction._id.toString(),
  orderRef: transaction.orderRef,
  providerOrderCode: transaction.providerOrderCode || null,
  status: transaction.status,
  provider: transaction.provider,
  amountVnd: transaction.amountVnd,
  currency: transaction.currency,
  clientPlatform: transaction.clientPlatform,
  paymentUrl: transaction.paymentUrl,
  paymentLinkId: transaction.paymentLinkId,
  package: transaction.packageSnapshot,
  packageId: transaction.packageId?.toString() || "",
  providerTxnRef: transaction.providerTxnRef,
  providerResponseCode: transaction.providerResponseCode,
  bankCode: transaction.bankCode,
  settledBy: transaction.settledBy || null,
  failureReason: transaction.failureReason,
  completedAt: transaction.completedAt
    ? transaction.completedAt.toISOString()
    : null,
  expiresAt: transaction.expiresAt.toISOString(),
  createdAt: transaction.createdAt.toISOString(),
});

export const assertUpgradeIsPossible = async (
  userId: string,
  targetPackage: IStoragePackage,
  stage: "ORDER" | "ACTIVATION",
): Promise<void> => {
  const storage = await ensureUserStorage(userId);
  const committed = (storage.usedBytes || 0) + (storage.reservedBytes || 0);

  if (targetPackage.capacityBytes < committed) {
    throw new AppError(
      "STORAGE_DOWNGRADE_BELOW_USAGE",
      409,
      "STORAGE_DOWNGRADE_BELOW_USAGE",
      {
        usedBytes: storage.usedBytes || 0,
        reservedBytes: storage.reservedBytes || 0,
        targetCapacityBytes: targetPackage.capacityBytes,
        targetPackageName: targetPackage.name,
        stage,
      },
    );
  }

  const currentPackage = await StoragePackage.findById(storage.packageId);
  if (
    targetPackage.priceVnd === 0 &&
    currentPackage &&
    currentPackage.priceVnd > 0
  ) {
    throw new AppError(
      "The Free plan cannot be selected after upgrading.",
      409,
      "STORAGE_FREE_PLAN_REACTIVATION_NOT_ALLOWED",
      {
        currentPackageName: currentPackage.name,
        targetPackageName: targetPackage.name,
        stage,
      },
    );
  }
};

/**
 * The only writer of quota on purchase. Per the product decision a new package
 * REPLACES the old one — quota becomes the new capacity rather than the sum —
 * and usedBytes/reservedBytes are deliberately untouched.
 */
export const activatePackage = async (
  transaction: IStorageTransaction,
): Promise<void> => {
  const userId = transaction.userId.toString();
  const pkg = await StoragePackage.findById(transaction.packageId);

  if (!pkg) {
    throw new AppError(
      "STORAGE_PACKAGE_NOT_FOUND",
      404,
      "STORAGE_PACKAGE_NOT_FOUND",
    );
  }

  // Usage can grow between placing the order and the callback arriving, so the
  // downgrade guard runs a second time here.
  await assertUpgradeIsPossible(userId, pkg, "ACTIVATION");

  await UserStorage.updateOne(
    { userId },
    {
      $set: {
        packageId: pkg._id,
        quotaBytes: pkg.capacityBytes,
        activatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  // Give the user a verified number the instant they land back on the page.
  await reconcileUserStorage(userId);
};

export interface CreatePurchaseInput {
  userId: string;
  packageId: string;
  platform: StorageClientPlatform;
  clientReturnUrl?: string;
  ipAddress: string;
}

export const createPurchaseOrder = async ({
  userId,
  packageId,
  platform,
  clientReturnUrl,
  ipAddress,
}: CreatePurchaseInput) => {
  const pkg = await StoragePackage.findOne({ _id: packageId, isActive: true });

  if (!pkg) {
    throw new AppError(
      "STORAGE_PACKAGE_NOT_FOUND",
      404,
      "STORAGE_PACKAGE_NOT_FOUND",
    );
  }

  const storage = await ensureUserStorage(userId);

  if (storage.packageId?.toString() === pkg._id.toString()) {
    throw new AppError(
      "STORAGE_PACKAGE_ALREADY_ACTIVE",
      409,
      "STORAGE_PACKAGE_ALREADY_ACTIVE",
      { packageName: pkg.name },
    );
  }

  await assertUpgradeIsPossible(userId, pkg, "ORDER");

  const provider = getPaymentProvider();
  const orderRef = generateOrderRef();
  // One TTL drives both our expiry and the hosted payment link expiry.
  const expiresAt = new Date(Date.now() + getOrderTtlMinutes() * 60 * 1000);

  const transaction = await StorageTransaction.create({
    userId: new Types.ObjectId(userId),
    packageId: pkg._id,
    packageSnapshot: {
      code: pkg.code,
      name: pkg.name,
      capacityBytes: pkg.capacityBytes,
      priceVnd: pkg.priceVnd,
    },
    amountVnd: pkg.priceVnd,
    provider: provider.name,
    status: "PENDING",
    orderRef,
    providerOrderCode: generateProviderOrderCode(),
    clientPlatform: platform,
    clientReturnUrl: platform === "MOBILE" ? clientReturnUrl || "" : "",
    previousPackageId: storage.packageId || null,
    expiresAt,
  });

  // A free package needs no gateway round trip at all.
  if (pkg.priceVnd <= 0) {
    const claimed = await StorageTransaction.findOneAndUpdate(
      { orderRef, status: "PENDING" },
      {
        $set: {
          status: "COMPLETED",
          completedAt: new Date(),
          providerResponseCode: "00",
          settledBy: "INLINE",
        },
      },
      { new: true },
    );

    if (claimed) {
      await activatePackage(claimed);
    }

    return {
      orderRef,
      providerOrderCode: transaction.providerOrderCode || null,
      requiresPayment: false,
      paymentUrl: "",
      provider: provider.name,
      amountVnd: pkg.priceVnd,
      expiresAt: expiresAt.toISOString(),
      package: toPackageResponse(pkg),
    };
  }

  const paymentInput: import("./payment/payment.types").CreatePaymentInput = {
    orderRef,
    providerOrderCode: transaction.providerOrderCode || generateProviderOrderCode(),
    amountVnd: pkg.priceVnd,
    orderInfo: `UP ${pkg.code}`,
    ipAddress,
    locale: "vn",
    returnUrl: new URL(
      `/api/storage/payments/${provider.name.toLowerCase()}/return`,
      `${getPublicApiBaseUrl()}/`,
    ).toString(),
    cancelUrl: new URL(
      `/api/storage/payments/${provider.name.toLowerCase()}/cancel`,
      `${getPublicApiBaseUrl()}/`,
    ).toString(),
    expiresAt,
  };
  const payment = provider.createPayment
    ? await provider.createPayment(paymentInput)
    : { paymentUrl: await provider.createPaymentUrl(paymentInput) };

  transaction.paymentUrl = payment.paymentUrl;
  transaction.paymentLinkId = payment.paymentLinkId || "";
  await transaction.save();

  return {
    orderRef,
    providerOrderCode: transaction.providerOrderCode || null,
    requiresPayment: true,
    paymentUrl: payment.paymentUrl,
    paymentLinkId: transaction.paymentLinkId,
    provider: provider.name,
    amountVnd: pkg.priceVnd,
    expiresAt: expiresAt.toISOString(),
    package: toPackageResponse(pkg),
  };
};

export interface SettlementResult {
  code: "00" | "01" | "02" | "04" | "97";
  message: string;
  transaction: IStorageTransaction | null;
}

/**
 * Shared by the IPN and the return redirect. The conditional transition is the
 * idempotency guard: only the request that flips PENDING receives a document,
 * so a duplicate or concurrent callback can never activate a package twice.
 */
export const settleTransaction = async (
  query: Record<string, string>,
  source: "RETURN" | "IPN" = "IPN",
): Promise<SettlementResult> => {
  const provider = getPaymentProvider();
  const result = provider.verifyCallback(query);

  if (!result.signatureValid) {
    return { code: "97", message: "Invalid signature", transaction: null };
  }

  const existing = await StorageTransaction.findOne({
    orderRef: result.orderRef,
  });

  if (!existing) {
    return { code: "01", message: "Order not found", transaction: null };
  }

  if (result.amountVnd && result.amountVnd !== existing.amountVnd * 100) {
    return { code: "04", message: "Invalid amount", transaction: existing };
  }

  const claimed = await StorageTransaction.findOneAndUpdate(
    { orderRef: result.orderRef, status: "PENDING" },
    {
      $set: {
        status: result.success ? "COMPLETED" : "FAILED",
        settledBy: source,
        ipnReceivedAt: new Date(),
        ipnRawQuery: result.raw,
        providerTxnRef: result.providerTxnRef,
        paymentLinkId: result.paymentLinkId || existing.paymentLinkId,
        providerResponseCode: result.responseCode,
        bankCode: result.bankCode,
        completedAt: result.success ? new Date() : null,
        failureReason: result.success
          ? ""
          : `PROVIDER_RESPONSE_${result.responseCode || "UNKNOWN"}`,
      },
    },
    { new: true },
  );

  if (!claimed) {
    // Already settled (or expired). This is the correct idempotent outcome and
    // tells VNPay to stop retrying.
    return {
      code: "02",
      message: "Order already confirmed",
      transaction: existing,
    };
  }

  if (result.success) {
    try {
      await activatePackage(claimed);
    } catch (error) {
      // Usage grew past the purchased capacity between order and callback.
      // Keep the old package and flag it for a manual refund.
      await StorageTransaction.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: "FAILED",
            failureReason: "DOWNGRADE_BELOW_USAGE_AT_ACTIVATION",
          },
        },
      );
      console.error(
        `[storage] Activation failed for order ${claimed.orderRef}; package not applied`,
        error,
      );
      return {
        code: "00",
        message: "Confirm Success",
        transaction: claimed,
      };
    }
  }

  return { code: "00", message: "Confirm Success", transaction: claimed };
};

export const settlePayosTransaction = async (
  result: import("./payment/payment.types").PaymentCallbackResult,
  source: "WEBHOOK" | "RETURN" = "WEBHOOK",
): Promise<SettlementResult> => {
  if (!result.signatureValid || !result.providerOrderCode) {
    return { code: "97", message: "Invalid PayOS webhook", transaction: null };
  }

  const existing = await StorageTransaction.findOne({
    providerOrderCode: result.providerOrderCode,
    provider: "PAYOS",
  });
  if (!existing) return { code: "01", message: "Order not found", transaction: null };
  if (result.amountVnd !== existing.amountVnd) {
    return { code: "04", message: "Invalid amount", transaction: existing };
  }
  if (existing.status !== "PENDING") {
    return { code: "02", message: "Order already confirmed", transaction: existing };
  }
  if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
    await StorageTransaction.updateOne(
      { _id: existing._id, status: "PENDING" },
      { $set: { status: "EXPIRED", failureReason: "ORDER_EXPIRED" } },
    );
    return { code: "02", message: "Order expired", transaction: existing };
  }

  const claimed = await StorageTransaction.findOneAndUpdate(
    { _id: existing._id, status: "PENDING" },
    {
      $set: {
        status: result.success ? "COMPLETED" : "FAILED",
        settledBy: source,
        ipnReceivedAt: new Date(),
        ipnRawQuery: result.raw,
        providerTxnRef: result.providerTxnRef,
        paymentLinkId: result.paymentLinkId || existing.paymentLinkId,
        providerResponseCode: result.responseCode,
        bankCode: result.bankCode,
        completedAt: result.success ? new Date() : null,
        failureReason: result.success
          ? ""
          : `PROVIDER_RESPONSE_${result.responseCode || "UNKNOWN"}`,
      },
    },
    { new: true },
  );

  if (!claimed) {
    return { code: "02", message: "Order already confirmed", transaction: existing };
  }

  if (result.success) {
    try {
      await activatePackage(claimed);
    } catch (error) {
      await StorageTransaction.updateOne(
        { _id: claimed._id },
        { $set: { status: "FAILED", failureReason: "DOWNGRADE_BELOW_USAGE_AT_ACTIVATION" } },
      );
      console.error(`[storage] PayOS activation failed for order ${claimed.orderRef}`, error);
    }
  }

  return { code: "00", message: "Confirm Success", transaction: claimed };
};

export const getTransactionByProviderOrderCode = async (providerOrderCode: number) =>
  StorageTransaction.findOne({ providerOrderCode, provider: "PAYOS" });

/** Lazily expires a stale PENDING order so a late callback cannot revive it. */
const expireIfStale = async (
  transaction: IStorageTransaction,
): Promise<IStorageTransaction> => {
  if (transaction.status !== "PENDING" || transaction.expiresAt > new Date()) {
    return transaction;
  }

  const expired = await StorageTransaction.findOneAndUpdate(
    { _id: transaction._id, status: "PENDING" },
    { $set: { status: "EXPIRED", failureReason: "ORDER_EXPIRED" } },
    { new: true },
  );

  return expired || transaction;
};

export const getTransactionForUser = async (
  orderRef: string,
  userId: string,
) => {
  const transaction = await StorageTransaction.findOne({ orderRef });

  if (!transaction || transaction.userId.toString() !== userId) {
    throw new AppError(
      "STORAGE_TRANSACTION_NOT_FOUND",
      404,
      "STORAGE_TRANSACTION_NOT_FOUND",
    );
  }

  const settled = await expireIfStale(transaction);
  const storage = await ensureUserStorage(userId);

  return {
    transaction: toTransactionResponse(settled),
    storage: await buildUserStorageResponse(storage),
  };
};

export const cancelTransaction = async (orderRef: string, userId: string) => {
  const transaction = await StorageTransaction.findOne({ orderRef });

  if (!transaction || transaction.userId.toString() !== userId) {
    throw new AppError(
      "STORAGE_TRANSACTION_NOT_FOUND",
      404,
      "STORAGE_TRANSACTION_NOT_FOUND",
    );
  }

  const cancelled = await StorageTransaction.findOneAndUpdate(
    { orderRef, status: "PENDING" },
    { $set: { status: "CANCELLED", failureReason: "CANCELLED_BY_USER" } },
    { new: true },
  );

  if (!cancelled) {
    throw new AppError(
      "STORAGE_TRANSACTION_NOT_PENDING",
      409,
      "STORAGE_TRANSACTION_NOT_PENDING",
      { status: transaction.status },
    );
  }

  return toTransactionResponse(cancelled);
};

export const listUserTransactions = async (
  userId: string,
  query: PaginationInput & { status?: string },
) => {
  const { page, limit, skip } = paginate(query);
  const filter: Record<string, unknown> = { userId };

  if (query.status) {
    filter.status = query.status;
  }

  const [items, totalItems] = await Promise.all([
    StorageTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    StorageTransaction.countDocuments(filter),
  ]);

  return {
    items: items.map(toTransactionResponse),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const expirePendingOrders = async (): Promise<{
  expiredCount: number;
}> => {
  const result = await StorageTransaction.updateMany(
    { status: "PENDING", expiresAt: { $lt: new Date() } },
    { $set: { status: "EXPIRED", failureReason: "ORDER_EXPIRED" } },
  );

  return { expiredCount: result.modifiedCount || 0 };
};
