import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { StudyDocument } from "../../models/document.model";
import { StoragePackage, IStoragePackage } from "./storagePackage.model";
import { UserStorage, IUserStorage } from "./userStorage.model";
import {
  StorageQuotaExceededError,
  StorageReservation,
  StoragePackageResponse,
  UserStorageResponse,
  resolveStorageStatus,
} from "./storage.types";

const RESERVATION_STALE_MINUTES = 10;

export const isQuotaEnforced = (): boolean =>
  process.env.STORAGE_QUOTA_ENFORCED !== "false";

export const toPackageResponse = (
  pkg: IStoragePackage,
): StoragePackageResponse => ({
  id: pkg._id.toString(),
  code: pkg.code,
  name: pkg.name,
  capacityBytes: pkg.capacityBytes,
  priceVnd: pkg.priceVnd,
  description: pkg.description || "",
  features: pkg.features || [],
  sortOrder: pkg.sortOrder || 0,
  isDefault: Boolean(pkg.isDefault),
  isActive: Boolean(pkg.isActive),
  highlight: Boolean(pkg.highlight),
});

export const getDefaultPackage = async (): Promise<IStoragePackage> => {
  const defaultPackage = await StoragePackage.findOne({ isDefault: true });

  if (!defaultPackage) {
    throw new AppError(
      "STORAGE_DEFAULT_PACKAGE_MISSING",
      500,
      "STORAGE_DEFAULT_PACKAGE_MISSING",
    );
  }

  return defaultPackage;
};

/**
 * Lazily provisions a UserStorage row on the default package. Called at the top
 * of every read/reserve path so no signup flow needs to know this module exists.
 * The upsert is atomic, so concurrent first-requests settle to one row.
 */
export const ensureUserStorage = async (
  userId: string,
): Promise<IUserStorage> => {
  const existing = await UserStorage.findOne({ userId });

  if (existing) {
    return existing;
  }

  const defaultPackage = await getDefaultPackage();

  await UserStorage.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId: new Types.ObjectId(userId),
        packageId: defaultPackage._id,
        quotaBytes: defaultPackage.capacityBytes,
        usedBytes: 0,
        reservedBytes: 0,
        activatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  const created = await UserStorage.findOne({ userId });

  if (!created) {
    throw new AppError(
      "STORAGE_PROVISION_FAILED",
      500,
      "STORAGE_PROVISION_FAILED",
    );
  }

  return created;
};

export const buildUserStorageResponse = async (
  storage: IUserStorage,
): Promise<UserStorageResponse> => {
  const pkg = await StoragePackage.findById(storage.packageId);
  const quotaBytes = storage.quotaBytes || 0;
  const usedBytes = storage.usedBytes || 0;
  const reservedBytes = storage.reservedBytes || 0;
  const availableBytes = Math.max(0, quotaBytes - usedBytes - reservedBytes);
  const usagePercent =
    quotaBytes > 0
      ? Math.min(100, Math.round(((usedBytes + reservedBytes) / quotaBytes) * 1000) / 10)
      : 100;

  return {
    usedBytes,
    reservedBytes,
    quotaBytes,
    availableBytes,
    usagePercent,
    status: resolveStorageStatus(usagePercent),
    package: pkg ? toPackageResponse(pkg) : null,
    activatedAt: storage.activatedAt ? storage.activatedAt.toISOString() : null,
    lastReconciledAt: storage.lastReconciledAt
      ? storage.lastReconciledAt.toISOString()
      : null,
  };
};

export const getUserStorage = async (
  userId: string,
): Promise<UserStorageResponse> => {
  const storage = await ensureUserStorage(userId);

  return buildUserStorageResponse(storage);
};

export const listStoragePackages = async (
  userId: string,
): Promise<{
  packages: StoragePackageResponse[];
  currentPackageId: string | null;
}> => {
  const [packages, storage] = await Promise.all([
    StoragePackage.find({ isActive: true }).sort({ sortOrder: 1, priceVnd: 1 }),
    ensureUserStorage(userId),
  ]);

  return {
    packages: packages.map(toPackageResponse),
    currentPackageId: storage.packageId ? storage.packageId.toString() : null,
  };
};

/**
 * The source of truth for consumed storage: every DocumentVersion that still has
 * a file on Cloudinary, including documents sitting in the trash and versions
 * that are no longer active. Soft deletes never remove the Cloudinary asset, so
 * those bytes are genuinely still being billed.
 *
 * Versions are the primary signal: `createDocument` writes the document and its
 * v1 version with the same filePublicId, so summing both would double count the
 * first upload of every document. Documents predating the versioning migration
 * have no version row at all, so they fall back to their own fileSize — without
 * that branch their bytes would be invisible and effectively free.
 */
export const computeActualUsedBytes = async (
  userId: string,
): Promise<number> => {
  const result = await StudyDocument.aggregate([
    { $match: { ownerId: new Types.ObjectId(userId) } },
    {
      $lookup: {
        from: "documentversions",
        localField: "_id",
        foreignField: "documentId",
        as: "versions",
      },
    },
    {
      $project: {
        bytes: {
          $cond: [
            { $gt: [{ $size: "$versions" }, 0] },
            { $sum: "$versions.fileSize" },
            { $ifNull: ["$fileSize", 0] },
          ],
        },
      },
    },
    { $group: { _id: null, usedBytes: { $sum: "$bytes" } } },
  ]);

  // $group over an empty set returns [], not a zero row.
  return result[0]?.usedBytes || 0;
};

export const reconcileUserStorage = async (
  userId: string,
): Promise<{ before: number; after: number; drift: number }> => {
  const storage = await ensureUserStorage(userId);
  const before = storage.usedBytes || 0;
  const after = await computeActualUsedBytes(userId);

  // Only usedBytes is rewritten. Leaving reservedBytes alone means a reconcile
  // racing an upload is at worst momentarily conservative, never permissive.
  await UserStorage.updateOne(
    { userId },
    { $set: { usedBytes: after, lastReconciledAt: new Date() } },
  );

  return { before, after, drift: after - before };
};

/**
 * Batch reconcile. Also clears reservations stranded by a process that died
 * between reserve and commit — the one silent failure mode of the reserve
 * pattern, which would otherwise shrink a user's usable quota forever.
 */
export const reconcileAllUserStorage = async (): Promise<{
  scanned: number;
  corrected: number;
  totalDrift: number;
  reservationsCleared: number;
}> => {
  const staleBefore = new Date(
    Date.now() - RESERVATION_STALE_MINUTES * 60 * 1000,
  );
  const staleReservations = await UserStorage.updateMany(
    { reservedBytes: { $gt: 0 }, updatedAt: { $lt: staleBefore } },
    { $set: { reservedBytes: 0 } },
  );

  const rows = await UserStorage.find().select("userId usedBytes").lean();
  let corrected = 0;
  let totalDrift = 0;

  for (const row of rows) {
    const userId = row.userId.toString();
    const actual = await computeActualUsedBytes(userId);

    if (actual !== (row.usedBytes || 0)) {
      await UserStorage.updateOne(
        { userId: row.userId },
        { $set: { usedBytes: actual, lastReconciledAt: new Date() } },
      );
      corrected += 1;
      totalDrift += Math.abs(actual - (row.usedBytes || 0));
    }
  }

  return {
    scanned: rows.length,
    corrected,
    totalDrift,
    reservationsCleared: staleReservations.modifiedCount || 0,
  };
};

/**
 * Atomically claims `bytes` of the user's remaining quota. The $expr guard is
 * what makes concurrent uploads safe without a transaction: two requests that
 * each fit alone but not together will see exactly one $inc succeed.
 */
export const reserveStorage = async (
  userId: string,
  bytes: number,
): Promise<StorageReservation | null> => {
  if (!isQuotaEnforced() || bytes <= 0) {
    return null;
  }

  await ensureUserStorage(userId);

  const updated = await UserStorage.findOneAndUpdate(
    {
      userId,
      $expr: {
        $lte: [
          { $add: ["$usedBytes", "$reservedBytes", bytes] },
          "$quotaBytes",
        ],
      },
    },
    { $inc: { reservedBytes: bytes } },
    { new: true },
  );

  if (updated) {
    return { userId, bytes };
  }

  const current = await ensureUserStorage(userId);
  const pkg = await StoragePackage.findById(current.packageId);
  const quotaBytes = current.quotaBytes || 0;
  const usedBytes = current.usedBytes || 0;
  const reservedBytes = current.reservedBytes || 0;

  throw new StorageQuotaExceededError({
    usedBytes,
    reservedBytes,
    quotaBytes,
    requiredBytes: bytes,
    availableBytes: Math.max(0, quotaBytes - usedBytes - reservedBytes),
    packageName: pkg?.name || "",
  });
};

/**
 * Reserve wrapper used by the upload paths. A quota rejection propagates, but
 * any *unexpected* failure of the storage subsystem fails OPEN: an outage in
 * quota accounting must never take down uploads, which are the product's core
 * loop. The periodic reconcile repairs whatever drifts in the meantime.
 */
export const reserveUploadCapacity = async (
  userId: string,
  bytes: number,
): Promise<StorageReservation | null> => {
  try {
    return await reserveStorage(userId, bytes);
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) {
      throw error;
    }

    console.error(
      "[storage.service] reserveUploadCapacity failed, allowing upload (fail-open)",
      error,
    );

    return null;
  }
};

export interface StorageDependencies {
  reserveStorage: typeof reserveUploadCapacity;
  commitReservation: typeof commitReservation;
  releaseReservation: typeof releaseReservation;
}

export interface ReservationSettler {
  /** Bytes are on Cloudinary and recorded: move reserved -> used. */
  commit: () => Promise<void>;
  /** Nothing was stored: give the reserved bytes back. */
  releaseIfPending: () => Promise<void>;
}

/** Makes commit/release idempotent so a settled reservation is never double-counted. */
export const createReservationSettler = (
  dependencies: StorageDependencies,
  reservation: StorageReservation | null,
): ReservationSettler => {
  let settled = false;

  return {
    commit: async () => {
      if (settled) {
        return;
      }
      settled = true;
      await dependencies.commitReservation(reservation);
    },
    releaseIfPending: async () => {
      if (settled) {
        return;
      }
      settled = true;
      await dependencies.releaseReservation(reservation);
    },
  };
};

export const commitReservation = async (
  reservation: StorageReservation | null,
): Promise<void> => {
  if (!reservation) {
    return;
  }

  await UserStorage.updateOne(
    { userId: reservation.userId },
    { $inc: { reservedBytes: -reservation.bytes, usedBytes: reservation.bytes } },
  );
  await clampCounters(reservation.userId);
};

export const releaseReservation = async (
  reservation: StorageReservation | null,
): Promise<void> => {
  if (!reservation) {
    return;
  }

  await UserStorage.updateOne(
    { userId: reservation.userId },
    { $inc: { reservedBytes: -reservation.bytes } },
  );
  await clampCounters(reservation.userId);
};

export const releaseUsage = async (
  userId: string,
  bytes: number,
): Promise<void> => {
  if (bytes <= 0) {
    return;
  }

  await UserStorage.updateOne({ userId }, { $inc: { usedBytes: -bytes } });
  await clampCounters(userId);
};

export const defaultStorageDependencies: StorageDependencies = {
  reserveStorage: reserveUploadCapacity,
  commitReservation,
  releaseReservation,
};

// A negative counter is worse than a stale one: it silently hands out free
// quota. Clamp instead of trusting the arithmetic to stay balanced.
const clampCounters = async (userId: string): Promise<void> => {
  await UserStorage.updateOne(
    { userId, usedBytes: { $lt: 0 } },
    { $set: { usedBytes: 0 } },
  );
  await UserStorage.updateOne(
    { userId, reservedBytes: { $lt: 0 } },
    { $set: { reservedBytes: 0 } },
  );
};
