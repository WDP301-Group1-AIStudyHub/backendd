import { Request, Response } from "express";
import { AppError } from "../../middlewares/error.middleware";
import { ActivityLogService } from "../../services/activityLog.service";
import { getIpAddress } from "../../utils/getIp";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendResponse } from "../../utils/apiResponse";
import {
  buildWebStorageReturnUrl,
  resolveMobileStorageReturnUrl,
} from "../../services/publicAppUrl.service";
import {
  getUserStorage,
  listStoragePackages,
  reconcileUserStorage,
} from "./storage.service";
import {
  cancelTransaction,
  createPurchaseOrder,
  getTransactionByProviderOrderCode,
  getTransactionForUser,
  listUserTransactions,
  settleTransaction,
  settlePayosTransaction,
} from "./storagePurchase.service";
import { getPaymentProvider } from "./payment";
import { renderMockCheckoutPage } from "./payment/mock.provider";
import { verifyPayosWebhook } from "./payment/payos.provider";
import { StorageTransaction } from "./storageTransaction.model";

const RECONCILE_COOLDOWN_MS = 60 * 1000;
const lastReconcileByUser = new Map<string, number>();

export const getStoragePackages = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await listStoragePackages(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Storage packages fetched successfully",
    data,
  });
});

export const getMyStorage = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const data = await getUserStorage(req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Storage usage fetched successfully",
    data,
  });
});

export const reconcileMyStorage = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.authUser!.id;
  const lastRun = lastReconcileByUser.get(userId) || 0;
  const elapsed = Date.now() - lastRun;

  if (elapsed < RECONCILE_COOLDOWN_MS) {
    throw new AppError(
      "STORAGE_RECONCILE_THROTTLED",
      429,
      "STORAGE_RECONCILE_THROTTLED",
      { retryAfterSeconds: Math.ceil((RECONCILE_COOLDOWN_MS - elapsed) / 1000) },
    );
  }

  lastReconcileByUser.set(userId, Date.now());

  const { drift } = await reconcileUserStorage(userId);
  const storage = await getUserStorage(userId);

  sendResponse(res, 200, {
    success: true,
    message: "Storage usage reconciled successfully",
    data: { ...storage, drift },
  });
});

export const purchaseStoragePackage = asyncHandler(async (
  req: Request<
    unknown,
    unknown,
    {
      packageId: string;
      platform?: "WEB" | "MOBILE";
      clientReturnUrl?: string;
    }
  >,
  res: Response,
): Promise<void> => {
  const data = await createPurchaseOrder({
    userId: req.authUser!.id,
    packageId: req.body.packageId,
    platform: req.body.platform || "WEB",
    clientReturnUrl: req.body.clientReturnUrl,
    ipAddress: getIpAddress(req) || "127.0.0.1",
  });

  await ActivityLogService.log({
    userId: req.authUser!.id,
    action: data.requiresPayment
      ? "STORAGE_PACKAGE_PURCHASE_INITIATED"
      : "STORAGE_PACKAGE_ACTIVATED",
    entityType: "Other",
    entityId: data.orderRef,
    details: { package: data.package.code, amountVnd: data.amountVnd },
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"],
  });

  sendResponse(res, 201, {
    success: true,
    message: data.requiresPayment
      ? "Purchase order created successfully"
      : "Storage package activated successfully",
    data,
  });
});

export const getStorageTransaction = asyncHandler(async (
  req: Request<{ orderRef: string }>,
  res: Response,
): Promise<void> => {
  const data = await getTransactionForUser(req.params.orderRef, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Transaction fetched successfully",
    data,
  });
});

export const listStorageTransactions = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await listUserTransactions(req.authUser!.id, req.query);

  res.status(200).json({
    success: true,
    message: "Transactions fetched successfully",
    ...result,
  });
});

export const cancelStorageTransaction = asyncHandler(async (
  req: Request<{ orderRef: string }>,
  res: Response,
): Promise<void> => {
  const data = await cancelTransaction(req.params.orderRef, req.authUser!.id);

  sendResponse(res, 200, {
    success: true,
    message: "Transaction cancelled successfully",
    data,
  });
});

/**
 * Where the gateway sends the human. Unauthenticated by nature: the user comes
 * back from VNPay's domain with no Bearer token.
 */
export const handlePaymentReturn = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const query = req.query as Record<string, string>;

  // Best-effort settle. If the IPN has not landed yet — a real risk on a cold
  // starting free-tier host — this closes the order instead. Whoever loses the
  // race simply gets "already confirmed" and does nothing.
  const result = await settleTransaction(query, "RETURN");
  const transaction = result.transaction;
  const orderRef = transaction?.orderRef || "";
  const status = transaction?.status || "INVALID";

  if (transaction) {
    await ActivityLogService.log({
      userId: transaction.userId.toString(),
      action:
        transaction.status === "COMPLETED"
          ? "STORAGE_PACKAGE_ACTIVATED"
          : "STORAGE_PACKAGE_PURCHASE_FAILED",
      entityType: "Other",
      entityId: orderRef,
      details: { status: transaction.status, provider: transaction.provider },
      ipAddress: getIpAddress(req),
      userAgent: req.headers["user-agent"],
    });
  }

  // The redirect target comes from our own record, never from the gateway's
  // query string, so there is no open-redirect surface here.
  const target =
    transaction?.clientPlatform === "MOBILE"
      ? resolveMobileStorageReturnUrl(
          transaction.clientReturnUrl,
          orderRef,
          status,
        )
      : buildWebStorageReturnUrl(orderRef, status);

  res.redirect(302, target);
});

/**
 * Server-to-server callback. No auth middleware: the signature is the entire
 * authentication. Always answers 200 with VNPay's RspCode envelope, because
 * VNPay reads the body, not the HTTP status.
 */
export const handlePaymentIpn = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await settleTransaction(req.query as Record<string, string>);

  res.status(200).json({ RspCode: result.code, Message: result.message });
});

const providerOrderCodeFromRequest = (req: Request): number => {
  const value = Number(req.query.orderCode || req.body?.data?.orderCode || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
};

const redirectPayosClient = (res: Response, transaction: Awaited<ReturnType<typeof getTransactionByProviderOrderCode>>, status: string): void => {
  const orderRef = transaction?.orderRef || "";
  const target = transaction?.clientPlatform === "MOBILE"
    ? resolveMobileStorageReturnUrl(transaction.clientReturnUrl, orderRef, status)
    : buildWebStorageReturnUrl(orderRef, status);
  res.redirect(302, target);
};

export const handlePayosWebhook = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await verifyPayosWebhook(req.body);
    const settled = await settlePayosTransaction(result, "WEBHOOK");
    res.status(200).json({ code: settled.code, desc: settled.message });
  } catch (error) {
    console.error("[storage] Invalid PayOS webhook", error);
    res.status(400).json({ code: "97", desc: "Invalid webhook" });
  }
});

export const handlePayosReturn = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const transaction = await getTransactionByProviderOrderCode(providerOrderCodeFromRequest(req));
  redirectPayosClient(res, transaction, transaction?.status || "PENDING");
});

export const handlePayosCancel = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const providerOrderCode = providerOrderCodeFromRequest(req);
  const transaction = await getTransactionByProviderOrderCode(providerOrderCode);
  redirectPayosClient(res, transaction, "CANCELLED");
});

export const renderMockCheckout = asyncHandler(async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (getPaymentProvider().name !== "MOCK") {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND");
  }

  const orderRef = String(req.query.orderRef || "");
  const transaction = await StorageTransaction.findOne({ orderRef });

  if (!transaction) {
    throw new AppError(
      "STORAGE_TRANSACTION_NOT_FOUND",
      404,
      "STORAGE_TRANSACTION_NOT_FOUND",
    );
  }

  res.status(200).type("html").send(
    renderMockCheckoutPage(
      orderRef,
      transaction.amountVnd,
      String(req.query.orderInfo || transaction.packageSnapshot.name),
    ),
  );
});
