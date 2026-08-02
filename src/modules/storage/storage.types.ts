import { AppError } from "../../middlewares/error.middleware";

export type StorageStatus = "OK" | "WARNING" | "CRITICAL" | "FULL";

export const STORAGE_WARNING_THRESHOLD = 80;
export const STORAGE_CRITICAL_THRESHOLD = 95;

export interface StoragePackageResponse {
  id: string;
  code: string;
  name: string;
  capacityBytes: number;
  priceVnd: number;
  description: string;
  features: string[];
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  highlight: boolean;
}

export interface UserStorageResponse {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  availableBytes: number;
  usagePercent: number;
  status: StorageStatus;
  package: StoragePackageResponse | null;
  activatedAt: string | null;
  lastReconciledAt: string | null;
}

export interface StorageQuotaDetails extends Record<string, unknown> {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  requiredBytes: number;
  availableBytes: number;
  packageName: string;
}

/**
 * Thrown before any Cloudinary work happens. 413 is the honest status, but both
 * clients branch on `code`, not on the status, so this can change safely.
 */
export class StorageQuotaExceededError extends AppError {
  constructor(details: StorageQuotaDetails) {
    super("STORAGE_QUOTA_EXCEEDED", 413, "STORAGE_QUOTA_EXCEEDED", details);
  }
}

export interface StorageReservation {
  userId: string;
  bytes: number;
}

export const resolveStorageStatus = (usagePercent: number): StorageStatus => {
  if (usagePercent >= 100) {
    return "FULL";
  }

  if (usagePercent >= STORAGE_CRITICAL_THRESHOLD) {
    return "CRITICAL";
  }

  if (usagePercent >= STORAGE_WARNING_THRESHOLD) {
    return "WARNING";
  }

  return "OK";
};
