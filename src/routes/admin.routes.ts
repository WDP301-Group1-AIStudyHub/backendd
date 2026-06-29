import { Router } from "express";
import {
  getActivityLogs,
  getDashboardStats,
  getDocuments,
  getUsers,
  updateDocumentStatus,
  deleteDocument,
  updateUserRole,
  banUser,
  unbanUser,
} from "../controllers/admin.controller";
import { authMiddleware, isAdminMiddleware } from "../middlewares/auth.middleware";

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
 * /api/admin/documents/{id}/status:
 *   put:
 *     summary: Update document status and visibility
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, ARCHIVED, DELETED]
 *               visibility:
 *                 type: string
 *                 enum: [PUBLIC, PRIVATE]
 *     responses:
 *       200:
 *         description: Document updated successfully
 */
router.put("/documents/:id/status", updateDocumentStatus);

/**
 * @swagger
 * /api/admin/documents/{id}:
 *   delete:
 *     summary: Soft delete a document
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 */
router.delete("/documents/:id", deleteDocument);

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   put:
 *     summary: Update user role
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
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *     responses:
 *       200:
 *         description: User role updated successfully
 */
router.put("/users/:id/role", updateUserRole);

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

export default router;
