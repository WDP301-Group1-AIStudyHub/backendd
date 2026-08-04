import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { StudyDocument } from "../../models/document.model";
import { StoragePackage } from "./storagePackage.model";
import { UserStorage } from "./userStorage.model";
import { StorageTransaction } from "./storageTransaction.model";
import {
  activatePackage,
  createPurchaseOrder,
  generateOrderRef,
  settlePayosTransaction,
  settleTransaction,
} from "./storagePurchase.service";

const originalPackageFindOne = StoragePackage.findOne;
const originalPackageFindById = StoragePackage.findById;
const originalUserStorageFindOne = UserStorage.findOne;
const originalUserStorageUpdateOne = UserStorage.updateOne;
const originalTransactionCreate = StorageTransaction.create;
const originalTransactionFindOne = StorageTransaction.findOne;
const originalTransactionFindOneAndUpdate = StorageTransaction.findOneAndUpdate;
const originalTransactionUpdateOne = StorageTransaction.updateOne;
const originalDocumentAggregate = StudyDocument.aggregate;

const USER_ID = new Types.ObjectId().toString();
const FREE_ID = new Types.ObjectId();
const PRO_ID = new Types.ObjectId();

const MB = 1024 * 1024;

const freePackage = {
  _id: FREE_ID,
  code: "FREE",
  name: "Gói Miễn Phí",
  capacityBytes: 100 * MB,
  priceVnd: 0,
  isActive: true,
};

const proPackage = {
  _id: PRO_ID,
  code: "PRO",
  name: "Gói Pro",
  capacityBytes: 500 * MB,
  priceVnd: 49000,
  isActive: true,
};

type Ctx = {
  storage: {
    userId: string;
    packageId: Types.ObjectId;
    quotaBytes: number;
    usedBytes: number;
    reservedBytes: number;
  };
  activations: number;
  savedTransactions: Record<string, unknown>[];
};

const setup = (overrides: Partial<Ctx["storage"]> = {}): Ctx => {
  process.env.PAYMENT_PROVIDER = "MOCK";
  const ctx: Ctx = {
    storage: {
      userId: USER_ID,
      packageId: FREE_ID,
      quotaBytes: 100 * MB,
      usedBytes: 10 * MB,
      reservedBytes: 0,
      ...overrides,
    },
    activations: 0,
    savedTransactions: [],
  };

  StoragePackage.findOne = (async (filter: Record<string, unknown>) => {
    const id = String(filter._id);
    if (id === String(PRO_ID)) return proPackage;
    if (id === String(FREE_ID)) return freePackage;
    return null;
  }) as unknown as typeof StoragePackage.findOne;

  StoragePackage.findById = (async (id: unknown) => {
    if (String(id) === String(PRO_ID)) return proPackage;
    if (String(id) === String(FREE_ID)) return freePackage;
    return null;
  }) as unknown as typeof StoragePackage.findById;

  UserStorage.findOne = (async () => ctx.storage) as unknown as typeof UserStorage.findOne;

  UserStorage.updateOne = (async (
    _filter: unknown,
    update: Record<string, Record<string, unknown>>,
  ) => {
    if (update.$set?.quotaBytes !== undefined) {
      ctx.activations += 1;
      ctx.storage.quotaBytes = update.$set.quotaBytes as number;
      ctx.storage.packageId = update.$set.packageId as Types.ObjectId;
    }
    if (typeof update.$set?.usedBytes === "number") {
      ctx.storage.usedBytes = update.$set.usedBytes;
    }
    return { modifiedCount: 1 };
  }) as unknown as typeof UserStorage.updateOne;

  StorageTransaction.create = (async (doc: Record<string, unknown>) => {
    const record = { ...doc, save: async () => {} };
    ctx.savedTransactions.push(record);
    return record;
  }) as unknown as typeof StorageTransaction.create;

  StorageTransaction.updateOne = (async () => ({
    modifiedCount: 1,
  })) as unknown as typeof StorageTransaction.updateOne;

  // activatePackage reconciles afterwards so the user sees a verified number;
  // without this stub the tests would reach for a real database.
  StudyDocument.aggregate = (async () => [
    { _id: null, usedBytes: ctx.storage.usedBytes },
  ]) as unknown as typeof StudyDocument.aggregate;

  return ctx;
};

afterEach(() => {
  StoragePackage.findOne = originalPackageFindOne;
  StoragePackage.findById = originalPackageFindById;
  UserStorage.findOne = originalUserStorageFindOne;
  UserStorage.updateOne = originalUserStorageUpdateOne;
  StorageTransaction.create = originalTransactionCreate;
  StorageTransaction.findOne = originalTransactionFindOne;
  StorageTransaction.findOneAndUpdate = originalTransactionFindOneAndUpdate;
  StorageTransaction.updateOne = originalTransactionUpdateOne;
  StudyDocument.aggregate = originalDocumentAggregate;
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.VNP_TMN_CODE;
  delete process.env.VNP_HASH_SECRET;
});

describe("order reference", () => {
  it("is alphanumeric and within VNPay's 34 character limit", () => {
    const ref = generateOrderRef();

    assert.ok(/^[A-Za-z0-9]+$/.test(ref), `not alphanumeric: ${ref}`);
    assert.ok(ref.length <= 34, `too long: ${ref.length}`);
    assert.notEqual(ref, generateOrderRef());
  });
});

describe("purchase order creation", () => {
  it("refuses a package smaller than what is already stored", async () => {
    // 200 MB in use, trying to move onto the 100 MB free plan.
    const ctx = setup({ packageId: PRO_ID, quotaBytes: 500 * MB, usedBytes: 200 * MB });

    await assert.rejects(
      () =>
        createPurchaseOrder({
          userId: USER_ID,
          packageId: String(FREE_ID),
          platform: "WEB",
          ipAddress: "127.0.0.1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "STORAGE_DOWNGRADE_BELOW_USAGE");
        assert.equal(error.details?.stage, "ORDER");
        return true;
      },
    );

    assert.equal(ctx.activations, 0);
  });

  it("counts in-flight reservations when checking a downgrade", async () => {
    setup({
      packageId: PRO_ID,
      quotaBytes: 500 * MB,
      usedBytes: 95 * MB,
      reservedBytes: 10 * MB,
    });

    await assert.rejects(
      () =>
        createPurchaseOrder({
          userId: USER_ID,
          packageId: String(FREE_ID),
          platform: "WEB",
          ipAddress: "127.0.0.1",
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "STORAGE_DOWNGRADE_BELOW_USAGE",
    );
  });

  it("refuses to re-buy the package already in use", async () => {
    setup({ packageId: PRO_ID, quotaBytes: 500 * MB });

    await assert.rejects(
      () =>
        createPurchaseOrder({
          userId: USER_ID,
          packageId: String(PRO_ID),
          platform: "WEB",
          ipAddress: "127.0.0.1",
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.code === "STORAGE_PACKAGE_ALREADY_ACTIVE",
    );
  });

  it("refuses to reactivate Free after a paid upgrade", async () => {
    const ctx = setup({ packageId: PRO_ID, quotaBytes: 500 * MB, usedBytes: 10 * MB });

    await assert.rejects(
      () =>
        createPurchaseOrder({
          userId: USER_ID,
          packageId: String(FREE_ID),
          platform: "WEB",
          ipAddress: "127.0.0.1",
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.code === "STORAGE_FREE_PLAN_REACTIVATION_NOT_ALLOWED" &&
        error.details?.stage === "ORDER",
    );

    assert.equal(ctx.activations, 0);
  });

  it("issues a payment url for a priced package and stays pending", async () => {
    const ctx = setup();

    const result = await createPurchaseOrder({
      userId: USER_ID,
      packageId: String(PRO_ID),
      platform: "MOBILE",
      ipAddress: "127.0.0.1",
    });

    assert.equal(result.requiresPayment, true);
    assert.ok(result.paymentUrl.length > 0);
    assert.equal(result.amountVnd, 49000);
    // Nothing is granted before the money arrives.
    assert.equal(ctx.activations, 0);
    assert.equal(ctx.savedTransactions[0].status, "PENDING");
    assert.equal(ctx.savedTransactions[0].clientPlatform, "MOBILE");
  });
});

describe("package activation", () => {
  it("replaces the quota instead of adding to it", async () => {
    const ctx = setup({ packageId: FREE_ID, quotaBytes: 100 * MB, usedBytes: 40 * MB });

    await activatePackage({
      userId: new Types.ObjectId(USER_ID),
      packageId: PRO_ID,
    } as never);

    // 500 MB, not 600 MB.
    assert.equal(ctx.storage.quotaBytes, 500 * MB);
    assert.equal(ctx.storage.packageId, PRO_ID);
    // Usage is never rewritten by a purchase.
    assert.equal(ctx.storage.usedBytes, 40 * MB);
  });

  it("refuses activation when usage grew past the purchased capacity", async () => {
    // Ordered while it fit; by the time the callback arrives it no longer does.
    setup({ packageId: PRO_ID, quotaBytes: 500 * MB, usedBytes: 200 * MB });

    await assert.rejects(
      () =>
        activatePackage({
          userId: new Types.ObjectId(USER_ID),
          packageId: FREE_ID,
        } as never),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "STORAGE_DOWNGRADE_BELOW_USAGE" &&
        error.details?.stage === "ACTIVATION",
    );
  });

  it("refuses Free activation after a paid upgrade even when usage fits", async () => {
    setup({ packageId: PRO_ID, quotaBytes: 500 * MB, usedBytes: 10 * MB });

    await assert.rejects(
      () =>
        activatePackage({
          userId: new Types.ObjectId(USER_ID),
          packageId: FREE_ID,
        } as never),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "STORAGE_FREE_PLAN_REACTIVATION_NOT_ALLOWED" &&
        error.details?.stage === "ACTIVATION",
    );
  });
});

describe("callback settlement", () => {
  const mockQuery = {
    vnp_TxnRef: "SPTEST01",
    vnp_Amount: "4900000",
    mockResult: "SUCCESS",
  };

  const pendingTransaction = () => ({
    _id: new Types.ObjectId(),
    orderRef: "SPTEST01",
    status: "PENDING",
    amountVnd: 49000,
    userId: new Types.ObjectId(USER_ID),
    packageId: PRO_ID,
  });

  it("activates exactly once even when the callback arrives twice", async () => {
    const ctx = setup();
    let claimed = false;

    StorageTransaction.findOne = (async () =>
      pendingTransaction()) as unknown as typeof StorageTransaction.findOne;

    // The conditional update is the idempotency guard: only the first caller
    // flips PENDING and therefore receives a document.
    StorageTransaction.findOneAndUpdate = (async () => {
      if (claimed) return null;
      claimed = true;
      return { ...pendingTransaction(), status: "COMPLETED" };
    }) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const first = await settleTransaction(mockQuery);
    const second = await settleTransaction(mockQuery);

    assert.equal(first.code, "00");
    assert.equal(second.code, "02");
    assert.equal(ctx.activations, 1);
  });

  it("rejects a callback whose amount does not match the order", async () => {
    const ctx = setup();
    let updateCalled = false;

    StorageTransaction.findOne = (async () =>
      pendingTransaction()) as unknown as typeof StorageTransaction.findOne;
    StorageTransaction.findOneAndUpdate = (async () => {
      updateCalled = true;
      return null;
    }) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const result = await settleTransaction({
      ...mockQuery,
      vnp_Amount: "100",
    });

    assert.equal(result.code, "04");
    assert.equal(updateCalled, false);
    assert.equal(ctx.activations, 0);
  });

  it("reports an unknown order reference without touching storage", async () => {
    const ctx = setup();

    StorageTransaction.findOne = (async () =>
      null) as unknown as typeof StorageTransaction.findOne;

    const result = await settleTransaction(mockQuery);

    assert.equal(result.code, "01");
    assert.equal(ctx.activations, 0);
  });

  it("cannot revive an order that already expired", async () => {
    const ctx = setup();

    StorageTransaction.findOne = (async () => ({
      ...pendingTransaction(),
      status: "EXPIRED",
    })) as unknown as typeof StorageTransaction.findOne;
    // The { status: "PENDING" } filter is what makes terminal states immutable.
    StorageTransaction.findOneAndUpdate = (async () =>
      null) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const result = await settleTransaction(mockQuery);

    assert.equal(result.code, "02");
    assert.equal(ctx.activations, 0);
  });

  it("marks the transaction failed when the payment was declined", async () => {
    const ctx = setup();

    StorageTransaction.findOne = (async () =>
      pendingTransaction()) as unknown as typeof StorageTransaction.findOne;
    StorageTransaction.findOneAndUpdate = (async (
      _filter: unknown,
      update: Record<string, Record<string, unknown>>,
    ) => ({
      ...pendingTransaction(),
      status: update.$set.status,
    })) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const result = await settleTransaction({
      ...mockQuery,
      mockResult: "CANCELLED",
    });

    assert.equal(result.code, "00");
    assert.equal(result.transaction?.status, "FAILED");
    assert.equal(ctx.activations, 0);
  });
});

describe("PayOS webhook settlement", () => {
  const pendingTransaction = () => ({
    _id: new Types.ObjectId(),
    orderRef: "SPPAYOS01",
    providerOrderCode: 123456789,
    status: "PENDING",
    amountVnd: 49000,
    userId: new Types.ObjectId(USER_ID),
    packageId: PRO_ID,
    paymentLinkId: "link-1",
  });

  it("activates a package once for a verified, exact-amount webhook", async () => {
    const ctx = setup();
    let claimed = false;
    StorageTransaction.findOne = (async () =>
      pendingTransaction()) as unknown as typeof StorageTransaction.findOne;
    StorageTransaction.findOneAndUpdate = (async () => {
      if (claimed) return null;
      claimed = true;
      return { ...pendingTransaction(), status: "COMPLETED" };
    }) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const callback = {
      orderRef: "",
      providerOrderCode: 123456789,
      success: true,
      amountVnd: 49000,
      providerTxnRef: "REF-1",
      paymentLinkId: "link-1",
      responseCode: "00",
      bankCode: "9704",
      signatureValid: true,
      raw: { orderCode: "123456789" },
    };
    const first = await settlePayosTransaction(callback);
    const duplicate = await settlePayosTransaction(callback);

    assert.equal(first.code, "00");
    assert.equal(duplicate.code, "02");
    assert.equal(ctx.activations, 1);
  });

  it("rejects a PayOS webhook whose amount differs from the order", async () => {
    const ctx = setup();
    let updateCalled = false;
    StorageTransaction.findOne = (async () =>
      pendingTransaction()) as unknown as typeof StorageTransaction.findOne;
    StorageTransaction.findOneAndUpdate = (async () => {
      updateCalled = true;
      return null;
    }) as unknown as typeof StorageTransaction.findOneAndUpdate;

    const result = await settlePayosTransaction({
      orderRef: "",
      providerOrderCode: 123456789,
      success: true,
      amountVnd: 1,
      providerTxnRef: "REF-1",
      responseCode: "00",
      bankCode: "",
      signatureValid: true,
      raw: {},
    });

    assert.equal(result.code, "04");
    assert.equal(updateCalled, false);
    assert.equal(ctx.activations, 0);
  });

  it("expires a stale PayOS order without activating its package", async () => {
    const ctx = setup();
    let expired = false;
    StorageTransaction.findOne = (async () => ({
      ...pendingTransaction(),
      expiresAt: new Date(Date.now() - 1_000),
    })) as unknown as typeof StorageTransaction.findOne;
    StorageTransaction.updateOne = (async () => {
      expired = true;
      return { acknowledged: true, modifiedCount: 1 };
    }) as unknown as typeof StorageTransaction.updateOne;

    const result = await settlePayosTransaction({
      orderRef: "",
      providerOrderCode: 123456789,
      success: true,
      amountVnd: 49000,
      providerTxnRef: "REF-LATE",
      responseCode: "00",
      bankCode: "",
      signatureValid: true,
      raw: {},
    });

    assert.equal(result.code, "02");
    assert.equal(result.message, "Order expired");
    assert.equal(expired, true);
    assert.equal(ctx.activations, 0);
  });
});
