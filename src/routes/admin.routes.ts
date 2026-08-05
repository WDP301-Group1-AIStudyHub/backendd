import { Router } from "express";
import {
  getActivityLogs,
  getDashboardStats,
  getDocuments,
  getUsers,
  banUser,
  unbanUser,
} from "../controllers/admin.controller";
import { authMiddleware, isAdminMiddleware } from "../middlewares/auth.middleware";
import {
  cancelAdminPaymentTransaction,
  getAdminPaymentTransactionDetail,
  getAdminPaymentTransactions,
  getAdminPaymentsOverview,
  getAdminStoragePackages,
  getAdminStorageOverview,
  getAdminStorageUserDetail,
  getAdminStorageUsers,
  patchAdminStoragePackage,
  patchAdminStorageUserPackage,
  postAdminStoragePackage,
  reconcileAdminStorageHandler,
  reconcileAdminStorageUserHandler,
} from "../controllers/adminStorage.controller";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  adminPaymentCancelSchema,
  adminPaymentOrderRefSchema,
  adminPaymentsOverviewSchema,
  adminPaymentsTransactionsSchema,
  adminStoragePackageChangeSchema,
  adminStoragePackageCreateSchema,
  adminStoragePackageUpdateSchema,
  adminStorageUserParamSchema,
  adminStorageUsersSchema,
} from "../modules/storage/adminStorage.validation";

const router = Router();

// Apply auth and admin check to all admin routes
router.use(authMiddleware, isAdminMiddleware);

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats retrieved successfully
 */
router.get("/dashboard", getDashboardStats);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get paginated list of users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search query for name or email
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 */
router.get("/users", getUsers);

/**
 * @swagger
 * /api/admin/documents:
 *   get:
 *     summary: Get paginated list of documents
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search query for document title
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 */
router.get("/documents", getDocuments);

/**
 * @swagger
 * /api/admin/logs:
 *   get:
 *     summary: Get system activity logs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *     responses:
 *       200:
 *         description: Logs retrieved successfully
 */
router.get("/logs", getActivityLogs);

/**
 * @swagger
 * /api/admin/users/{id}/ban:
 *   put:
 *     summary: Ban a user account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: User banned successfully
 */
router.put("/users/:id/ban", banUser);

/**
 * @swagger
 * /api/admin/users/{id}/unban:
 *   put:
 *     summary: Unban a user account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User unbanned successfully
 */
router.put("/users/:id/unban", unbanUser);

// Storage management. These routes intentionally live under the existing
// admin middleware so a normal user receives the same 403 as other admin APIs.
router.get("/storage/overview", getAdminStorageOverview);
router.get("/storage/users", validateRequest(adminStorageUsersSchema), getAdminStorageUsers);
router.get(
  "/storage/users/:userId",
  validateRequest(adminStorageUserParamSchema),
  getAdminStorageUserDetail,
);
router.patch(
  "/storage/users/:userId/package",
  validateRequest(adminStoragePackageChangeSchema),
  patchAdminStorageUserPackage,
);
router.post(
  "/storage/users/:userId/reconcile",
  validateRequest(adminStorageUserParamSchema),
  reconcileAdminStorageUserHandler,
);
router.post("/storage/reconcile", reconcileAdminStorageHandler);
router.get("/storage/packages", getAdminStoragePackages);
router.post(
  "/storage/packages",
  validateRequest(adminStoragePackageCreateSchema),
  postAdminStoragePackage,
);
router.patch(
  "/storage/packages/:packageId",
  validateRequest(adminStoragePackageUpdateSchema),
  patchAdminStoragePackage,
);

// Payment audit and controlled cancellation. Completed transactions are
// intentionally read-only because VNPay refund is outside this integration.
router.get(
  "/payments/overview",
  validateRequest(adminPaymentsOverviewSchema),
  getAdminPaymentsOverview,
);
router.get(
  "/payments/transactions",
  validateRequest(adminPaymentsTransactionsSchema),
  getAdminPaymentTransactions,
);
router.get(
  "/payments/transactions/:orderRef",
  validateRequest(adminPaymentOrderRefSchema),
  getAdminPaymentTransactionDetail,
);
router.post(
  "/payments/transactions/:orderRef/cancel",
  validateRequest(adminPaymentCancelSchema),
  cancelAdminPaymentTransaction,
);

export default router;
