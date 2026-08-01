import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  buildSignData,
  formatVnpayDate,
  signVnpayParams,
  vnpayProvider,
} from "./vnpay.provider";

const SECRET = "TESTHASHSECRET";

afterEach(() => {
  delete process.env.VNP_TMN_CODE;
  delete process.env.VNP_HASH_SECRET;
  delete process.env.VNP_URL;
});

describe("vnpay signing", () => {
  it("sorts keys ASCII and encodes spaces as plus, not %20", () => {
    const signData = buildSignData({
      vnp_OrderInfo: "Nang cap goi PRO",
      vnp_Amount: "4900000",
      vnp_TmnCode: "DEMO",
    });

    // Sorted: vnp_Amount, vnp_OrderInfo, vnp_TmnCode.
    assert.equal(
      signData,
      "vnp_Amount=4900000&vnp_OrderInfo=Nang+cap+goi+PRO&vnp_TmnCode=DEMO",
    );
    assert.ok(!signData.includes("%20"));
  });

  it("produces the HMAC-SHA512 of the sign string", () => {
    const params = { vnp_Amount: "100", vnp_TxnRef: "SP1" };
    const expected = crypto
      .createHmac("sha512", SECRET)
      .update(Buffer.from("vnp_Amount=100&vnp_TxnRef=SP1", "utf-8"))
      .digest("hex");

    assert.equal(signVnpayParams(params, SECRET), expected);
    assert.equal(expected.length, 128);
  });

  it("formats dates in GMT+7 regardless of the server timezone", () => {
    // 2026-01-01T00:00:00Z is 07:00 on the same day in GMT+7.
    assert.equal(
      formatVnpayDate(new Date("2026-01-01T00:00:00.000Z")),
      "20260101070000",
    );
    // Crossing midnight backwards is the case a naive UTC formatter gets wrong.
    assert.equal(
      formatVnpayDate(new Date("2026-01-01T18:30:00.000Z")),
      "20260102013000",
    );
  });
});

describe("vnpay callback verification", () => {
  const buildSignedQuery = (
    overrides: Record<string, string> = {},
  ): Record<string, string> => {
    const params: Record<string, string> = {
      vnp_Amount: "4900000",
      vnp_BankCode: "NCB",
      vnp_ResponseCode: "00",
      vnp_TransactionNo: "14012345",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: "SP20260101000000ABCDEF",
      ...overrides,
    };

    return {
      ...params,
      vnp_SecureHash: signVnpayParams(params, SECRET),
    };
  };

  it("accepts a correctly signed successful callback", () => {
    process.env.VNP_HASH_SECRET = SECRET;

    const result = vnpayProvider.verifyCallback(buildSignedQuery());

    assert.equal(result.signatureValid, true);
    assert.equal(result.success, true);
    assert.equal(result.orderRef, "SP20260101000000ABCDEF");
    assert.equal(result.amountVnd, 4900000);
  });

  it("rejects a callback whose payload was altered after signing", () => {
    process.env.VNP_HASH_SECRET = SECRET;

    const query = buildSignedQuery();
    query.vnp_Amount = "100";

    const result = vnpayProvider.verifyCallback(query);

    assert.equal(result.signatureValid, false);
    assert.equal(result.success, false);
  });

  it("returns invalid rather than throwing when the hash is missing", () => {
    process.env.VNP_HASH_SECRET = SECRET;

    const query = buildSignedQuery();
    delete query.vnp_SecureHash;

    const result = vnpayProvider.verifyCallback(query);

    assert.equal(result.signatureValid, false);
  });

  it("excludes vnp_SecureHashType from the verified sign string", () => {
    process.env.VNP_HASH_SECRET = SECRET;

    // VNPay sometimes includes this field; leaving it in the sign string breaks
    // every callback.
    const query = { ...buildSignedQuery(), vnp_SecureHashType: "SHA512" };

    assert.equal(vnpayProvider.verifyCallback(query).signatureValid, true);
  });

  it("treats a signed non-zero response code as a failed payment", () => {
    process.env.VNP_HASH_SECRET = SECRET;

    const result = vnpayProvider.verifyCallback(
      buildSignedQuery({ vnp_ResponseCode: "24" }),
    );

    assert.equal(result.signatureValid, true);
    assert.equal(result.success, false);
    assert.equal(result.responseCode, "24");
  });
});

describe("vnpay payment url", () => {
  it("multiplies the amount by 100 and appends a valid signature", () => {
    process.env.VNP_TMN_CODE = "DEMO";
    process.env.VNP_HASH_SECRET = SECRET;
    process.env.VNP_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";

    const url = vnpayProvider.createPaymentUrl({
      orderRef: "SP20260101000000ABCDEF",
      amountVnd: 49000,
      orderInfo: "Nang cap goi PRO",
      ipAddress: "127.0.0.1",
      locale: "vn",
      returnUrl: "https://api.example.com/api/storage/payments/vnpay/return",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    });

    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("vnp_Amount"), "4900000");
    assert.equal(parsed.searchParams.get("vnp_TxnRef"), "SP20260101000000ABCDEF");
    assert.equal(parsed.searchParams.get("vnp_ExpireDate"), "20260101071500");

    // Round trip: the signature the builder emits must satisfy the verifier.
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    assert.equal(vnpayProvider.verifyCallback(query).signatureValid, true);
  });
});
