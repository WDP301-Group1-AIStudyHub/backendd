import { Request, Response } from "express";
import { ActivityLogService } from "../services/activityLog.service";
import {
  AdminPaymentListQuery,
  AdminStorageListQuery,
  cancelAdminPayment,
  changeStorageUserPackage,
  createStoragePackage,
  getPaymentTransactionDetail,
  getPaymentsOverview,
  getStorageOverview,
  getStorageUserDetail,
  listPaymentTransactions,
  listStoragePackagesForAdmin,
  listStorageUsers,
  reconcileAdminStorage,
  reconcileAdminStorageUser,
  updateStoragePackage,
} from "../services/adminStorage.service";
import { asyncHandler } from "../utils/asyncHandler";
import { getIpAddress } from "../utils/getIp";
import { sendResponse } from "../utils/apiResponse";

const audit = (req: Request, action: Parameters<typeof ActivityLogService.log>[0]["action"], entityId: string | undefined, details: Record<string, unknown>) =>
  ActivityLogService.log({
    userId: req.authUser!.id,
    action,
    entityType: entityId ? "User" : "Other",
    ...(entityId ? { entityId } : {}),
    details,
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"],
  });

export const getAdminStorageOverview = asyncHandler(async (_req: Request, res: Response) => {
  sendResponse(res, 200, { success: true, message: "Storage overview fetched successfully", data: await getStorageOverview() });
});

export const getAdminStorageUsers = asyncHandler(async (req: Request, res: Response) => {
  const data = await listStorageUsers(req.query as unknown as AdminStorageListQuery);
  sendResponse(res, 200, { success: true, message: "Storage users fetched successfully", data });
});

export const getAdminStorageUserDetail = asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  sendResponse(res, 200, { success: true, message: "Storage user detail fetched successfully", data: await getStorageUserDetail(req.params.userId) });
});

export const patchAdminStorageUserPackage = asyncHandler(async (
  req: Request<{ userId: string }, unknown, { packageId: string; reason: string }>,
  res: Response,
) => {
  const data = await changeStorageUserPackage(req.params.userId, req.body.packageId);
  await audit(req, "ADMIN_STORAGE_USER_PACKAGE_CHANGED", req.params.userId, {
    packageId: req.body.packageId,
    reason: req.body.reason,
    previousPackage: data.previousPackage?.code || null,
    newPackage: data.package.code,
  });
  sendResponse(res, 200, { success: true, message: "User storage package changed successfully", data });
});

export const reconcileAdminStorageUserHandler = asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  const data = await reconcileAdminStorageUser(req.params.userId);
  await audit(req, "ADMIN_STORAGE_RECONCILED", req.params.userId, { scope: "USER", ...data.reconciliation });
  sendResponse(res, 200, { success: true, message: "User storage reconciled successfully", data });
});

export const reconcileAdminStorageHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await reconcileAdminStorage();
  await audit(req, "ADMIN_STORAGE_RECONCILED", undefined, { scope: "ALL", ...data });
  sendResponse(res, 200, { success: true, message: "All storage reconciled successfully", data });
});

export const getAdminStoragePackages = asyncHandler(async (_req: Request, res: Response) => {
  sendResponse(res, 200, { success: true, message: "Storage packages fetched successfully", data: await listStoragePackagesForAdmin() });
});

export const postAdminStoragePackage = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const data = await createStoragePackage(req.body);
  await audit(req, "ADMIN_STORAGE_PACKAGE_CREATED", undefined, { package: data.code, packageId: data.id });
  sendResponse(res, 201, { success: true, message: "Storage package created successfully", data });
});

export const patchAdminStoragePackage = asyncHandler(async (
  req: Request<{ packageId: string }>,
  res: Response,
) => {
  const data = await updateStoragePackage(req.params.packageId, req.body);
  await audit(req, "ADMIN_STORAGE_PACKAGE_UPDATED", undefined, { packageId: req.params.packageId, package: data.code, changes: req.body });
  sendResponse(res, 200, { success: true, message: "Storage package updated successfully", data });
});

export const getAdminPaymentsOverview = asyncHandler(async (req: Request, res: Response) => {
  const data = await getPaymentsOverview(req.query as unknown as Pick<AdminPaymentListQuery, "dateFrom" | "dateTo">);
  sendResponse(res, 200, { success: true, message: "Payment overview fetched successfully", data });
});

export const getAdminPaymentTransactions = asyncHandler(async (req: Request, res: Response) => {
  const data = await listPaymentTransactions(req.query as unknown as AdminPaymentListQuery);
  sendResponse(res, 200, { success: true, message: "Payment transactions fetched successfully", data });
});

export const getAdminPaymentTransactionDetail = asyncHandler(async (req: Request<{ orderRef: string }>, res: Response) => {
  sendResponse(res, 200, { success: true, message: "Payment transaction detail fetched successfully", data: await getPaymentTransactionDetail(req.params.orderRef) });
});

export const cancelAdminPaymentTransaction = asyncHandler(async (
  req: Request<{ orderRef: string }, unknown, { reason: string }>,
  res: Response,
) => {
  const data = await cancelAdminPayment(req.params.orderRef);
  await audit(req, "ADMIN_PAYMENT_CANCELLED", undefined, { orderRef: req.params.orderRef, reason: req.body.reason, userId: data.user?.id || null });
  sendResponse(res, 200, { success: true, message: "Pending payment cancelled successfully", data });
});

