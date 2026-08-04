import assert from "node:assert/strict";
import { PayOS } from "@payos/node";
import { afterEach, describe, it } from "node:test";
import { verifyPayosWebhook } from "./payos.provider";

const CHECKSUM_KEY = "payos-test-checksum";

afterEach(() => {
  delete process.env.PAYOS_CLIENT_ID;
  delete process.env.PAYOS_API_KEY;
  delete process.env.PAYOS_CHECKSUM_KEY;
});

describe("PayOS webhook verification", () => {
  it("accepts a correctly signed webhook and maps its numeric order code", async () => {
    process.env.PAYOS_CLIENT_ID = "client";
    process.env.PAYOS_API_KEY = "api";
    process.env.PAYOS_CHECKSUM_KEY = CHECKSUM_KEY;

    const data = {
      orderCode: 123456789,
      amount: 49000,
      description: "UP PRO",
      accountNumber: "123456",
      reference: "REF-1",
      transactionDateTime: "2026-08-04 22:00:00",
      currency: "VND",
      paymentLinkId: "link-1",
      code: "00",
      desc: "Thành công",
    };
    const signature = await new PayOS({ checksumKey: CHECKSUM_KEY }).crypto.createSignatureFromObj(
      data,
      CHECKSUM_KEY,
    );

    const result = await verifyPayosWebhook({
      code: "00",
      desc: "success",
      success: true,
      data,
      signature: signature || "",
    });

    assert.equal(result.signatureValid, true);
    assert.equal(result.success, true);
    assert.equal(result.providerOrderCode, 123456789);
    assert.equal(result.amountVnd, 49000);
    assert.equal(result.paymentLinkId, "link-1");
  });

  it("rejects a tampered webhook signature", async () => {
    process.env.PAYOS_CLIENT_ID = "client";
    process.env.PAYOS_API_KEY = "api";
    process.env.PAYOS_CHECKSUM_KEY = CHECKSUM_KEY;

    await assert.rejects(
      verifyPayosWebhook({
        code: "00",
        desc: "success",
        success: true,
        data: {
          orderCode: 123456789,
          amount: 49000,
          description: "UP PRO",
        },
        signature: "invalid",
      }),
    );
  });
});
