import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import { User } from "../models/user.model";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { StoragePackage } from "../modules/storage/storagePackage.model";
import { UserStorage } from "../modules/storage/userStorage.model";
import { computeActualUsedBytes } from "../modules/storage/storage.service";

const PAGE_SIZE = 200;

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
};

/**
 * Legacy documents that predate both the versioning migration and the ownerId
 * rename (they still carry only `uploadedBy`). computeActualUsedBytes matches on
 * ownerId, so these are invisible to quota — deliberately: the rest of the app
 * filters on ownerId too, so their owner cannot see or delete them. Charging for
 * files nobody can reach would create a full quota with no way out.
 */
const inspectUnattributedDocuments = async (): Promise<{
  versionless: number;
  ownerless: number;
  bytes: number;
}> => {
  const versionedIds = await DocumentVersion.distinct("documentId");
  const versioned = new Set(versionedIds.map((id: unknown) => String(id)));
  const documents = await StudyDocument.find()
    .select("_id fileSize ownerId")
    .lean();
  const versionless = documents.filter(
    (doc: { _id: unknown }) => !versioned.has(String(doc._id)),
  );
  const ownerless = documents.filter(
    (doc: { ownerId?: unknown }) => !doc.ownerId,
  );

  return {
    versionless: versionless.length,
    ownerless: ownerless.length,
    bytes: ownerless.reduce(
      (sum: number, doc: { fileSize?: number }) => sum + (doc.fileSize || 0),
      0,
    ),
  };
};

const backfillUserStorage = async (): Promise<void> => {
  await connectDatabase();

  const defaultPackage = await StoragePackage.findOne({ isDefault: true });

  if (!defaultPackage) {
    throw new Error(
      "No default storage package found. Run `npm run seed:storage-packages` first.",
    );
  }

  const unattributed = await inspectUnattributedDocuments();
  if (unattributed.ownerless > 0) {
    console.log(
      `Note: ${unattributed.ownerless} legacy document(s) have no ownerId (only the old uploadedBy field), holding ${formatBytes(unattributed.bytes)}. They are NOT charged to anyone because no user can see or delete them.`,
    );
  }
  if (unattributed.versionless > unattributed.ownerless) {
    console.log(
      `Note: ${unattributed.versionless - unattributed.ownerless} owned document(s) have no DocumentVersion row; they are counted via the Document.fileSize fallback.`,
    );
  }

  const totalUsers = await User.countDocuments();
  const overQuota: { email: string; usedBytes: number }[] = [];
  let processed = 0;
  let createdRows = 0;

  for (let skip = 0; skip < totalUsers; skip += PAGE_SIZE) {
    const users = await User.find()
      .select("_id email")
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean();

    for (const user of users) {
      const userId = user._id.toString();
      const usedBytes = await computeActualUsedBytes(userId);
      const existing = await UserStorage.findOne({ userId });

      if (existing) {
        // Already provisioned: this is just a reconcile, keep their package.
        await UserStorage.updateOne(
          { userId },
          { $set: { usedBytes, lastReconciledAt: new Date() } },
        );
      } else {
        await UserStorage.create({
          userId: user._id,
          packageId: defaultPackage._id,
          quotaBytes: defaultPackage.capacityBytes,
          usedBytes,
          reservedBytes: 0,
          activatedAt: new Date(),
          lastReconciledAt: new Date(),
        });
        createdRows += 1;
      }

      const quota = existing ? existing.quotaBytes : defaultPackage.capacityBytes;
      if (usedBytes > quota) {
        overQuota.push({ email: user.email, usedBytes });
      }

      processed += 1;
    }
  }

  console.log(
    `Backfill complete. Processed ${processed} user(s), created ${createdRows} new storage row(s).`,
  );

  if (overQuota.length === 0) {
    console.log("No user is currently over their quota.");
    return;
  }

  // These accounts keep every existing file; only new uploads get blocked once
  // enforcement is switched on.
  console.log(
    `\n${overQuota.length} user(s) are ALREADY OVER quota (${formatBytes(defaultPackage.capacityBytes)} on ${defaultPackage.code}):`,
  );
  for (const entry of overQuota.sort((a, b) => b.usedBytes - a.usedBytes)) {
    console.log(`  ${entry.email.padEnd(40)} ${formatBytes(entry.usedBytes)}`);
  }
  console.log(
    "\nThey will not be able to upload until they delete files or buy a package.",
  );
};

backfillUserStorage()
  .catch((error) => {
    console.error("User storage backfill failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
