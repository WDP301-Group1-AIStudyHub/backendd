import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import { StoragePackage } from "../modules/storage/storagePackage.model";

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

// Every package shares the same 10 MB per-file ceiling. That limit is already
// enforced by upload.middleware.ts and happens to match Cloudinary's raw-file
// cap on the free plan, so it needs no code of its own — only a mention here
// and on the pricing cards.
const PACKAGES = [
  {
    code: "FREE",
    name: "Free",
    capacityBytes: 100 * MB,
    priceVnd: 0,
    description: "Room for roughly 60 average study documents.",
    // Every plan has the same features — storage is the only difference. Listing
    // sharing and workspaces only on the paid tiers would imply a gate that does
    // not exist in the code.
    features: [
      "100 MB of storage",
      "Up to 10 MB per file",
      "AI chat over your uploaded documents",
      "Document sharing and subject workspaces",
    ],
    sortOrder: 1,
    isDefault: true,
    highlight: false,
  },
  {
    code: "PRO",
    name: "Pro",
    capacityBytes: 500 * MB,
    priceVnd: 49000,
    description: "Five times the space — enough for a full semester.",
    features: [
      "500 MB of storage",
      "Up to 10 MB per file",
      "AI chat over your uploaded documents",
      "Document sharing and subject workspaces",
    ],
    sortOrder: 2,
    isDefault: false,
    highlight: true,
  },
  {
    code: "ULTRA",
    name: "Ultra",
    capacityBytes: 1 * GB,
    priceVnd: 99000,
    description: "The most space, for a whole multi-subject course load.",
    features: [
      "1 GB of storage",
      "Up to 10 MB per file",
      "AI chat over your uploaded documents",
      "Document sharing and subject workspaces",
    ],
    sortOrder: 3,
    isDefault: false,
    highlight: false,
  },
];

const seedStoragePackages = async (): Promise<void> => {
  await connectDatabase();

  let created = 0;
  let existing = 0;

  let refreshed = 0;

  for (const pkg of PACKAGES) {
    const { name, description, features, sortOrder, highlight, ...rest } = pkg;

    const result = await StoragePackage.updateOne(
      { code: pkg.code },
      {
        // Display copy follows the code, so re-running fixes wording and
        // translations without a migration.
        $set: { name, description, features, sortOrder, highlight },
        // Commercial terms are insert-only: re-running never resets a price or
        // capacity an admin deliberately changed.
        $setOnInsert: rest,
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    if (result.upsertedCount > 0) {
      created += 1;
      console.log(
        `Created package ${pkg.code}: ${pkg.capacityBytes} bytes, ${pkg.priceVnd} VND`,
      );
    } else {
      existing += 1;
      if (result.modifiedCount > 0) {
        refreshed += 1;
        console.log(`Package ${pkg.code} exists; refreshed display copy`);
      } else {
        console.log(`Package ${pkg.code} already up to date`);
      }
    }
  }

  console.log(
    `Seed complete. Created ${created}, existing ${existing} (${refreshed} refreshed).`,
  );
};

seedStoragePackages()
  .catch((error) => {
    console.error("Storage package seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
