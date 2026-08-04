import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  cancelStorageTransaction,
  getMyStorage,
  getStoragePackages,
  getStorageTransaction,
  handlePaymentIpn,
  handlePaymentReturn,
  handlePayosCancel,
  handlePayosReturn,
  handlePayosWebhook,
  listStorageTransactions,
  purchaseStoragePackage,
  reconcileMyStorage,
  renderMockCheckout,
} from "./storage.controller";
import {
  createPurchaseSchema,
  listTransactionsSchema,
  orderRefParamSchema,
} from "./storage.validation";

export const storageRouter = Router();

// ─── Public payment callbacks ───────────────────────────────────────────────
// Registered BEFORE the auth middleware: the gateway calls the IPN with no
// token, and the user returns from the gateway's domain without one either.
// The signature check inside settleTransaction is the authentication.

/**
 * @swagger
 * /api/storage/payments/vnpay/return:
 *   get:
 *     summary: Payment gateway browser redirect; settles then redirects to the client
 *     tags: [Storage]
 *     responses:
 *       302:
 *         description: Redirect to the web app or the mobile deep link
 */
storageRouter.get("/payments/vnpay/return", handlePaymentReturn);

/**
 * @swagger
 * /api/storage/payments/vnpay/ipn:
 *   get:
 *     summary: Server-to-server payment notification (idempotent)
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: VNPay RspCode envelope
 */
storageRouter.get("/payments/vnpay/ipn", handlePaymentIpn);

storageRouter.post("/payments/payos/webhook", handlePayosWebhook);
storageRouter.get("/payments/payos/return", handlePayosReturn);
storageRouter.get("/payments/payos/cancel", handlePayosCancel);

/**
 * @swagger
 * /api/storage/payments/mock/checkout:
 *   get:
 *     summary: Simulated checkout page, served only while no gateway is configured
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: HTML checkout page
 *       404:
 *         description: A real payment provider is configured
 */
storageRouter.get("/payments/mock/checkout", renderMockCheckout);

// ─── Authenticated routes ───────────────────────────────────────────────────
storageRouter.use(authMiddleware);

/**
 * @swagger
 * /api/storage/packages:
 *   get:
 *     summary: List active storage packages and the caller's current package
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Packages fetched successfully
 */
storageRouter.get("/packages", getStoragePackages);

/**
 * @swagger
 * /api/storage/me:
 *   get:
 *     summary: Get the caller's storage quota, usage and warning status
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Storage usage fetched successfully
 */
storageRouter.get("/me", getMyStorage);

/**
 * @swagger
 * /api/storage/reconcile:
 *   post:
 *     summary: Recompute used storage from actual document versions
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Storage usage reconciled successfully
 *       429:
 *         description: Reconcile requested again within the cooldown window
 */
storageRouter.post("/reconcile", reconcileMyStorage);

/**
 * @swagger
 * /api/storage/purchases:
 *   post:
 *     summary: Create a purchase order for a storage package
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Order created, or package activated when the price is zero
 *       409:
 *         description: Package already active, or capacity below current usage
 */
storageRouter.post(
  "/purchases",
  validateRequest(createPurchaseSchema),
  purchaseStoragePackage,
);

/**
 * @swagger
 * /api/storage/transactions:
 *   get:
 *     summary: List the caller's storage transactions
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transactions fetched successfully
 */
storageRouter.get(
  "/transactions",
  validateRequest(listTransactionsSchema),
  listStorageTransactions,
);

/**
 * @swagger
 * /api/storage/transactions/{orderRef}:
 *   get:
 *     summary: Poll one transaction plus the caller's current storage snapshot
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction and storage fetched successfully
 */
storageRouter.get(
  "/transactions/:orderRef",
  validateRequest(orderRefParamSchema),
  getStorageTransaction,
);

/**
 * @swagger
 * /api/storage/transactions/{orderRef}/cancel:
 *   post:
 *     summary: Cancel a pending transaction
 *     tags: [Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction cancelled successfully
 *       409:
 *         description: Transaction is no longer pending
 */
storageRouter.post(
  "/transactions/:orderRef/cancel",
  validateRequest(orderRefParamSchema),
  cancelStorageTransaction,
);
