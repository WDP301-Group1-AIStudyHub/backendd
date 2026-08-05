import { Types } from "mongoose";
import { AppError } from "../middlewares/error.middleware";
import { buildPaginationResponse, paginate, PaginationInput } from "../common/utils/pagination.util";
import { User, IUser } from "../models/user.model";
import { StoragePackage, IStoragePackage } from "../modules/storage/storagePackage.model";
import { UserStorage, IUserStorage } from "../modules/storage/userStorage.model";
import {
  IStorageTransaction,
  StoragePaymentProvider,
  StorageClientPlatform,
  StorageTransaction,
  StorageTransactionStatus,
} from "../modules/storage/storageTransaction.model";
import {
  buildUserStorageResponse,
  ensureUserStorage,
  reconcileAllUserStorage,
  reconcileUserStorage,
  toPackageResponse,
} from "../modules/storage/storage.service";
import { resolveStorageStatus } from "../modules/storage/storage.types";
import { assertUpgradeIsPossible } from "../modules/storage/storagePurchase.service";

export interface AdminStorageListQuery extends PaginationInput {
  search?: string;
  packageId?: string;
  status?: "OK" | "WARNING" | "CRITICAL" | "FULL";
}

export interface AdminPaymentListQuery extends PaginationInput {
  status?: StorageTransactionStatus;
  provider?: StoragePaymentProvider;
  platform?: StorageClientPlatform;
  packageId?: string;
  userId?: string;
  orderRef?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDate = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid ${field}`, 400, "ADMIN_INVALID_DATE");
  }
  return parsed;
};

const dateFilter = (dateFrom?: string, dateTo?: string): Record<string, Date> | undefined => {
  const from = parseDate(dateFrom, "dateFrom");
  const to = parseDate(dateTo, "dateTo");
  if (!from && !to) return undefined;
  if (from && to && from > to) {
    throw new AppError("dateFrom must be before dateTo", 400, "ADMIN_INVALID_DATE_RANGE");
  }
  return { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
};

const toUserSummary = (user: Partial<IUser> | null | undefined) =>
  user
    ? {
        id: user._id?.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      }
    : null;

const toAdminTransaction = (
  transaction: IStorageTransaction,
  user?: Partial<IUser> | null,
) => ({
  id: transaction._id.toString(),
  orderRef: transaction.orderRef,
  providerOrderCode: transaction.providerOrderCode || null,
  status: transaction.status,
  provider: transaction.provider,
  clientPlatform: transaction.clientPlatform,
  amountVnd: transaction.amountVnd,
  currency: transaction.currency,
  packageId: transaction.packageId?.toString() || "",
  package: transaction.packageSnapshot,
  providerTxnRef: transaction.providerTxnRef || "",
  paymentLinkId: transaction.paymentLinkId || "",
  providerResponseCode: transaction.providerResponseCode || "",
  bankCode: transaction.bankCode || "",
  settledBy: transaction.settledBy || null,
  failureReason: transaction.failureReason || "",
  completedAt: transaction.completedAt?.toISOString() || null,
  expiresAt: transaction.expiresAt.toISOString(),
  createdAt: transaction.createdAt.toISOString(),
  updatedAt: transaction.updatedAt.toISOString(),
  user: toUserSummary(user),
});

const storageSnapshot = (storage: IUserStorage, pkg?: IStoragePackage | null) => {
  const quotaBytes = storage.quotaBytes || 0;
  const usedBytes = storage.usedBytes || 0;
  const reservedBytes = storage.reservedBytes || 0;
  const usagePercent = quotaBytes
    ? Math.min(100, Math.round(((usedBytes + reservedBytes) / quotaBytes) * 1000) / 10)
    : 100;
  return {
    usedBytes,
    reservedBytes,
    quotaBytes,
    availableBytes: Math.max(0, quotaBytes - usedBytes - reservedBytes),
    usagePercent,
    status: resolveStorageStatus(usagePercent),
    package: pkg ? toPackageResponse(pkg) : null,
    activatedAt: storage.activatedAt?.toISOString() || null,
    lastReconciledAt: storage.lastReconciledAt?.toISOString() || null,
  };
};

export const getStorageOverview = async () => {
  const [totalUsers, aggregate] = await Promise.all([
    User.countDocuments(),
    UserStorage.aggregate([
      {
        $addFields: {
          usagePercent: {
            $cond: [
              { $gt: ["$quotaBytes", 0] },
              {
                $multiply: [
                  { $divide: [{ $add: ["$usedBytes", "$reservedBytes"] }, "$quotaBytes"] },
                  100,
                ],
              },
              100,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          storageUsers: { $sum: 1 },
          totalQuotaBytes: { $sum: "$quotaBytes" },
          totalUsedBytes: { $sum: "$usedBytes" },
          totalReservedBytes: { $sum: "$reservedBytes" },
          usersAtRisk: {
            $sum: { $cond: [{ $gte: ["$usagePercent", 80] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  const row = aggregate[0] || {
    storageUsers: 0,
    totalQuotaBytes: 0,
    totalUsedBytes: 0,
    totalReservedBytes: 0,
    usersAtRisk: 0,
  };
  const totalQuotaBytes = row.totalQuotaBytes || 0;
  const totalUsedBytes = row.totalUsedBytes || 0;
  const totalReservedBytes = row.totalReservedBytes || 0;
  return {
    totalUsers,
    storageUsers: row.storageUsers || 0,
    totalQuotaBytes,
    totalUsedBytes,
    totalReservedBytes,
    totalAvailableBytes: Math.max(0, totalQuotaBytes - totalUsedBytes - totalReservedBytes),
    usagePercent: totalQuotaBytes
      ? Math.round(((totalUsedBytes + totalReservedBytes) / totalQuotaBytes) * 1000) / 10
      : 0,
    usersAtRisk: row.usersAtRisk || 0,
  };
};

export const listStorageUsers = async (query: AdminStorageListQuery) => {
  const { page, limit, skip } = paginate(query, { defaultLimit: 20 });
  const filter: Record<string, unknown> = {};
  if (query.packageId) filter.packageId = new Types.ObjectId(query.packageId);
  if (query.search) {
    const matchedUsers = await User.find({
      $or: [
        { fullName: { $regex: escapeRegex(query.search), $options: "i" } },
        { email: { $regex: escapeRegex(query.search), $options: "i" } },
      ],
    }).select("_id").lean();
    filter.userId = { $in: matchedUsers.map((user) => user._id) };
  }
  const rows = await UserStorage.find(filter)
    .sort({ updatedAt: -1 })
    .populate("userId", "fullName email role isActive")
    .populate("packageId", "code name capacityBytes priceVnd isActive isDefault")
    .lean();
  const mapped = rows
    .map((row) => {
      const user = row.userId as unknown as Partial<IUser>;
      const pkg = row.packageId as unknown as IStoragePackage;
      const snapshot = storageSnapshot(row as unknown as IUserStorage, pkg);
      return {
        user: toUserSummary(user),
        storage: snapshot,
      };
    })
    .filter((row) => !query.status || row.storage.status === query.status);
  const items = mapped.slice(skip, skip + limit);
  return {
    items,
    pagination: buildPaginationResponse(page, limit, mapped.length),
  };
};

export const getStorageUserDetail = async (userId: string) => {
  const user = await User.findById(userId).select("fullName email role isActive createdAt").lean();
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  const storage = await ensureUserStorage(userId);
  const pkg = await StoragePackage.findById(storage.packageId);
  const transactions = await StorageTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return {
    user: { ...toUserSummary(user), createdAt: user.createdAt?.toISOString() || null },
    storage: await buildUserStorageResponse(storage),
    recentTransactions: transactions.map((transaction) => toAdminTransaction(transaction as unknown as IStorageTransaction)),
    package: pkg ? toPackageResponse(pkg) : null,
  };
};

export const changeStorageUserPackage = async (
  userId: string,
  packageId: string,
) => {
  const user = await User.findById(userId).select("fullName email role isActive").lean();
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  const target = await StoragePackage.findOne({ _id: packageId, isActive: true });
  if (!target) throw new AppError("Storage package not found or inactive", 404, "STORAGE_PACKAGE_NOT_FOUND");
  const storage = await ensureUserStorage(userId);
  const previousPackage = await StoragePackage.findById(storage.packageId);
  if (storage.packageId.toString() === target._id.toString()) {
    throw new AppError("Storage package is already active", 409, "STORAGE_PACKAGE_ALREADY_ACTIVE");
  }
  await assertUpgradeIsPossible(userId, target, "ACTIVATION");
  await UserStorage.updateOne(
    { userId },
    { $set: { packageId: target._id, quotaBytes: target.capacityBytes, activatedAt: new Date() } },
  );
  const reconciliation = await reconcileUserStorage(userId);
  return {
    user: toUserSummary(user),
    previousPackage: previousPackage ? toPackageResponse(previousPackage) : null,
    package: toPackageResponse(target),
    storage: await buildUserStorageResponse(await ensureUserStorage(userId)),
    reconciliation,
  };
};

export const reconcileAdminStorageUser = async (userId: string) => {
  const user = await User.findById(userId).select("fullName email role isActive").lean();
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  const reconciliation = await reconcileUserStorage(userId);
  return {
    user: toUserSummary(user),
    reconciliation,
    storage: await buildUserStorageResponse(await ensureUserStorage(userId)),
  };
};

export const reconcileAdminStorage = reconcileAllUserStorage;

export interface AdminStoragePackageInput {
  code: string;
  name: string;
  capacityBytes: number;
  priceVnd: number;
  description?: string;
  features?: string[];
  sortOrder?: number;
  highlight?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
}

export const createStoragePackage = async (input: AdminStoragePackageInput) => {
  const hasDefault = Boolean(await StoragePackage.exists({ isDefault: true }));
  // Keep the invariant that a new user can always be provisioned. If an old
  // database has no default (for example after a manual cleanup), the first
  // package created by an admin becomes the default automatically.
  const isDefault = Boolean(input.isDefault) || !hasDefault;
  if (isDefault) await StoragePackage.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  const pkg = await StoragePackage.create({
    ...input,
    code: input.code.toUpperCase(),
    description: input.description || "",
    features: input.features || [],
    sortOrder: input.sortOrder || 0,
    highlight: Boolean(input.highlight),
    isActive: input.isActive !== false,
    isDefault,
  });
  return toPackageResponse(pkg);
};

export const updateStoragePackage = async (
  packageId: string,
  input: Omit<Partial<AdminStoragePackageInput>, "code">,
) => {
  const pkg = await StoragePackage.findById(packageId);
  if (!pkg) throw new AppError("Storage package not found", 404, "STORAGE_PACKAGE_NOT_FOUND");
  const nextActive = input.isActive === undefined ? pkg.isActive : input.isActive;
  const nextDefault = input.isDefault === undefined ? pkg.isDefault : input.isDefault;
  if (nextDefault && !nextActive) {
    throw new AppError("Default package must be active", 409, "STORAGE_DEFAULT_PACKAGE_MUST_BE_ACTIVE");
  }
  if (pkg.isDefault && !nextDefault) {
    const replacement = await StoragePackage.findOne({ _id: { $ne: pkg._id }, isDefault: true, isActive: true });
    if (!replacement) {
      throw new AppError("The only default package cannot be disabled", 409, "STORAGE_DEFAULT_PACKAGE_REQUIRED");
    }
  }
  if (pkg.isDefault && !nextActive) {
    throw new AppError("The only default package cannot be disabled", 409, "STORAGE_DEFAULT_PACKAGE_REQUIRED");
  }
  if (nextDefault) await StoragePackage.updateMany({ _id: { $ne: pkg._id }, isDefault: true }, { $set: { isDefault: false } });
  const update: Record<string, unknown> = {};
  for (const key of ["name", "capacityBytes", "priceVnd", "description", "features", "sortOrder", "highlight", "isActive", "isDefault"]) {
    if (input[key as keyof typeof input] !== undefined) update[key] = input[key as keyof typeof input];
  }
  Object.assign(pkg, update);
  await pkg.save();
  return toPackageResponse(pkg);
};

export const listStoragePackagesForAdmin = async () => {
  const packages = await StoragePackage.find().sort({ sortOrder: 1, priceVnd: 1 });
  return packages.map(toPackageResponse);
};

const paymentFilter = async (query: AdminPaymentListQuery): Promise<Record<string, unknown>> => {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.provider) filter.provider = query.provider;
  if (query.platform) filter.clientPlatform = query.platform;
  if (query.packageId) filter.packageId = new Types.ObjectId(query.packageId);
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);
  if (query.orderRef) filter.orderRef = { $regex: escapeRegex(query.orderRef), $options: "i" };
  const createdAt = dateFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;
  if (query.search) {
    const users = await User.find({
      $or: [
        { fullName: { $regex: escapeRegex(query.search), $options: "i" } },
        { email: { $regex: escapeRegex(query.search), $options: "i" } },
      ],
    }).select("_id").lean();
    filter.userId = { $in: users.map((user) => user._id) };
  }
  return filter;
};

export const getPaymentsOverview = async (query: Pick<AdminPaymentListQuery, "dateFrom" | "dateTo">) => {
  const createdAt = dateFilter(query.dateFrom, query.dateTo);
  const match = createdAt ? { createdAt } : {};
  const [summary] = await StorageTransaction.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          { $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenueVnd: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$amountVnd", 0] } }, completedCount: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }, pendingOrders: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } } } },
        ],
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 }, amountVnd: { $sum: "$amountVnd" } } }],
        byProvider: [{ $group: { _id: "$provider", count: { $sum: 1 }, amountVnd: { $sum: "$amountVnd" } } }],
        byPlatform: [{ $group: { _id: "$clientPlatform", count: { $sum: 1 }, amountVnd: { $sum: "$amountVnd" } } }],
      },
    },
  ]);
  const totals = summary?.totals?.[0] || { totalTransactions: 0, totalRevenueVnd: 0, completedCount: 0, pendingOrders: 0 };
  const mapBreakdown = (rows: Array<{ _id: string; count: number; amountVnd: number }>) => Object.fromEntries(rows.map((row) => [row._id, { count: row.count, amountVnd: row.amountVnd }]));
  return {
    totalTransactions: totals.totalTransactions || 0,
    totalRevenueVnd: totals.totalRevenueVnd || 0,
    completedCount: totals.completedCount || 0,
    pendingOrders: totals.pendingOrders || 0,
    byStatus: mapBreakdown(summary?.byStatus || []),
    byProvider: mapBreakdown(summary?.byProvider || []),
    byPlatform: mapBreakdown(summary?.byPlatform || []),
    dateFrom: query.dateFrom || null,
    dateTo: query.dateTo || null,
  };
};

export const listPaymentTransactions = async (query: AdminPaymentListQuery) => {
  const { page, limit, skip } = paginate(query, { defaultLimit: 20 });
  const filter = await paymentFilter(query);
  const [transactions, totalItems] = await Promise.all([
    StorageTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("userId", "fullName email role isActive"),
    StorageTransaction.countDocuments(filter),
  ]);
  return {
    items: transactions.map((transaction) => {
      const user = transaction.userId as unknown as Partial<IUser>;
      return toAdminTransaction(transaction, user);
    }),
    pagination: buildPaginationResponse(page, limit, totalItems),
  };
};

export const getPaymentTransactionDetail = async (orderRef: string) => {
  const transaction = await StorageTransaction.findOne({ orderRef }).populate("userId", "fullName email role isActive createdAt");
  if (!transaction) throw new AppError("Transaction not found", 404, "STORAGE_TRANSACTION_NOT_FOUND");
  const user = transaction.userId as unknown as Partial<IUser>;
  return toAdminTransaction(transaction, user);
};

export const cancelAdminPayment = async (orderRef: string) => {
  const current = await StorageTransaction.findOne({ orderRef });
  if (!current) throw new AppError("Transaction not found", 404, "STORAGE_TRANSACTION_NOT_FOUND");
  const cancelled = await StorageTransaction.findOneAndUpdate(
    { orderRef, status: "PENDING" },
    { $set: { status: "CANCELLED", failureReason: "CANCELLED_BY_ADMIN" } },
    { new: true },
  );
  if (!cancelled) {
    throw new AppError("Only pending transactions can be cancelled", 409, "STORAGE_TRANSACTION_NOT_PENDING", { status: current.status });
  }
  const user = await User.findById(cancelled.userId).select("fullName email role isActive").lean();
  return toAdminTransaction(cancelled, user);
};
