import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../../models/document.model";
import { StoragePackage } from "./storagePackage.model";
import { UserStorage } from "./userStorage.model";
import { StorageQuotaExceededError } from "./storage.types";
import {
  commitReservation,
  computeActualUsedBytes,
  createReservationSettler,
  ensureUserStorage,
  reconcileUserStorage,
  releaseUsage,
  reserveStorage,
} from "./storage.service";

const originalUserStorageFindOne = UserStorage.findOne;
const originalUserStorageFindOneAndUpdate = UserStorage.findOneAndUpdate;
const originalUserStorageUpdateOne = UserStorage.updateOne;
const originalPackageFindOne = StoragePackage.findOne;
const originalPackageFindById = StoragePackage.findById;
const originalDocumentAggregate = StudyDocument.aggregate;

const USER_ID = new Types.ObjectId().toString();
const QUOTA = 100 * 1024 * 1024;

type StorageRow = {
  userId: string;
  packageId: Types.ObjectId;
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
};

/**
 * Stands in for the single-document conditional update in reserveStorage. The
 * $expr guard is evaluated here the same way MongoDB would, so the tests cover
 * the real admission rule rather than a simplified one.
 */
const stubUserStorage = (row: StorageRow) => {
  UserStorage.findOne = (async () => row) as unknown as typeof UserStorage.findOne;

  UserStorage.findOneAndUpdate = (async (
    filter: Record<string, unknown>,
    update: Record<string, Record<string, number>>,
  ) => {
    const requested = update.$inc?.reservedBytes ?? 0;

    if (filter.$expr) {
      const fits =
        row.usedBytes + row.reservedBytes + requested <= row.quotaBytes;
      if (!fits) {
        return null;
      }
    }

    row.reservedBytes += requested;
    return row;
  }) as unknown as typeof UserStorage.findOneAndUpdate;

  UserStorage.updateOne = (async (
    filter: Record<string, unknown>,
    update: Record<string, Record<string, number>>,
  ) => {
    // The clamp updates carry a { field: { $lt: 0 } } guard, so the stub has to
    // honour filters rather than applying every $set unconditionally.
    const matchesGuard = (field: "usedBytes" | "reservedBytes"): boolean => {
      const condition = filter[field] as { $lt?: number } | undefined;
      if (!condition || typeof condition.$lt !== "number") {
        return true;
      }
      return row[field] < condition.$lt;
    };

    if (!matchesGuard("usedBytes") || !matchesGuard("reservedBytes")) {
      return { modifiedCount: 0 };
    }

    if (update.$inc) {
      row.usedBytes += update.$inc.usedBytes ?? 0;
      row.reservedBytes += update.$inc.reservedBytes ?? 0;
    }
    if (update.$set && typeof update.$set.usedBytes === "number") {
      row.usedBytes = update.$set.usedBytes;
    }
    if (update.$set && typeof update.$set.reservedBytes === "number") {
      row.reservedBytes = update.$set.reservedBytes;
    }
    return { modifiedCount: 1 };
  }) as unknown as typeof UserStorage.updateOne;

  StoragePackage.findById = (async () => ({
    _id: row.packageId,
    name: "Gói Miễn Phí",
    capacityBytes: row.quotaBytes,
  })) as unknown as typeof StoragePackage.findById;

  return row;
};

const makeRow = (overrides: Partial<StorageRow> = {}): StorageRow => ({
  userId: USER_ID,
  packageId: new Types.ObjectId(),
  quotaBytes: QUOTA,
  usedBytes: 0,
  reservedBytes: 0,
  ...overrides,
});

afterEach(() => {
  UserStorage.findOne = originalUserStorageFindOne;
  UserStorage.findOneAndUpdate = originalUserStorageFindOneAndUpdate;
  UserStorage.updateOne = originalUserStorageUpdateOne;
  StoragePackage.findOne = originalPackageFindOne;
  StoragePackage.findById = originalPackageFindById;
  StudyDocument.aggregate = originalDocumentAggregate;
  delete process.env.STORAGE_QUOTA_ENFORCED;
});

describe("storage service - reservations", () => {
  it("accepts an upload that lands exactly on the quota", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: QUOTA - 1024 }));

    const reservation = await reserveStorage(USER_ID, 1024);

    assert.ok(reservation);
    assert.equal(reservation?.bytes, 1024);
    assert.equal(row.reservedBytes, 1024);
  });

  it("rejects an upload that exceeds the quota by one byte", async () => {
    stubUserStorage(makeRow({ usedBytes: QUOTA - 1024 }));

    await assert.rejects(
      () => reserveStorage(USER_ID, 1025),
      (error: unknown) => {
        assert.ok(error instanceof StorageQuotaExceededError);
        assert.equal(error.statusCode, 413);
        assert.equal(error.code, "STORAGE_QUOTA_EXCEEDED");
        // Both clients render these numbers, so their presence is part of the
        // contract, not an implementation detail.
        assert.equal(error.details?.requiredBytes, 1025);
        assert.equal(error.details?.availableBytes, 1024);
        assert.equal(error.details?.packageName, "Gói Miễn Phí");
        return true;
      },
    );
  });

  it("counts bytes already reserved by an in-flight upload", async () => {
    // Fits against usedBytes alone, but not once the in-flight reservation is
    // taken into account. This is what stops two concurrent uploads both
    // squeezing into the same free space.
    stubUserStorage(
      makeRow({ usedBytes: QUOTA - 4096, reservedBytes: 3072 }),
    );

    await assert.rejects(
      () => reserveStorage(USER_ID, 2048),
      (error: unknown) => error instanceof StorageQuotaExceededError,
    );
  });

  it("returns the reserved bytes when the upload fails", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: 5000 }));
    const reservation = await reserveStorage(USER_ID, 1000);
    assert.equal(row.reservedBytes, 1000);

    const settler = createReservationSettler(
      {
        reserveStorage,
        commitReservation,
        releaseReservation: async (res) => {
          if (res) row.reservedBytes -= res.bytes;
        },
      },
      reservation,
    );

    await settler.releaseIfPending();
    assert.equal(row.reservedBytes, 0);
    assert.equal(row.usedBytes, 5000);
  });

  it("moves reserved bytes into used bytes on commit, once only", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: 5000 }));
    const reservation = await reserveStorage(USER_ID, 1000);

    const settler = createReservationSettler(
      { reserveStorage, commitReservation, releaseReservation: async () => {} },
      reservation,
    );

    await settler.commit();
    // A second settle must be a no-op: double counting quota is worse than a
    // stale counter.
    await settler.commit();
    await settler.releaseIfPending();

    assert.equal(row.usedBytes, 6000);
    assert.equal(row.reservedBytes, 0);
  });

  it("clamps used bytes at zero when more is released than recorded", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: 500 }));

    await releaseUsage(USER_ID, 900);

    assert.equal(row.usedBytes, 0);
  });

  it("skips reservation entirely when enforcement is switched off", async () => {
    process.env.STORAGE_QUOTA_ENFORCED = "false";
    const row = stubUserStorage(makeRow({ usedBytes: QUOTA }));

    const reservation = await reserveStorage(USER_ID, 10 * 1024 * 1024);

    assert.equal(reservation, null);
    assert.equal(row.reservedBytes, 0);
  });
});

describe("storage service - provisioning", () => {
  it("provisions a missing row on the default package", async () => {
    const packageId = new Types.ObjectId();
    let created: Record<string, unknown> | null = null;

    UserStorage.findOne = (async () => created) as unknown as typeof UserStorage.findOne;
    StoragePackage.findOne = (async () => ({
      _id: packageId,
      capacityBytes: QUOTA,
      isDefault: true,
    })) as unknown as typeof StoragePackage.findOne;
    UserStorage.updateOne = (async (
      _filter: unknown,
      update: Record<string, Record<string, unknown>>,
    ) => {
      // $setOnInsert makes the upsert idempotent under concurrency.
      created = update.$setOnInsert;
      return { upsertedCount: 1 };
    }) as unknown as typeof UserStorage.updateOne;

    const row = await ensureUserStorage(USER_ID);

    assert.equal(row.quotaBytes, QUOTA);
    assert.equal(row.usedBytes, 0);
    assert.equal(String(row.packageId), String(packageId));
  });
});

describe("storage service - reconcile", () => {
  it("sums every version, including trashed documents and old versions", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: 999 }));
    StudyDocument.aggregate = (async () => [
      { _id: null, usedBytes: 4096 },
    ]) as unknown as typeof StudyDocument.aggregate;

    const result = await reconcileUserStorage(USER_ID);

    assert.equal(result.before, 999);
    assert.equal(result.after, 4096);
    assert.equal(result.drift, 4096 - 999);
    assert.equal(row.usedBytes, 4096);
  });

  it("leaves in-flight reservations untouched while reconciling", async () => {
    const row = stubUserStorage(makeRow({ usedBytes: 100, reservedBytes: 250 }));
    StudyDocument.aggregate = (async () => [
      { _id: null, usedBytes: 100 },
    ]) as unknown as typeof StudyDocument.aggregate;

    await reconcileUserStorage(USER_ID);

    assert.equal(row.reservedBytes, 250);
  });

  it("reports zero, not NaN, for a user with no documents", async () => {
    stubUserStorage(makeRow());
    // $group over an empty set returns [], not a zero row.
    StudyDocument.aggregate = (async () =>
      []) as unknown as typeof StudyDocument.aggregate;

    const used = await computeActualUsedBytes(USER_ID);

    assert.equal(used, 0);
    assert.ok(!Number.isNaN(used));
  });
});
