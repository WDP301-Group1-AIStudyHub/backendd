import crypto from "node:crypto";
import {
  CreatePaymentInput,
  PaymentCallbackResult,
  PaymentProvider,
} from "./payment.types";

const VNP_VERSION = "2.1.0";
const DEFAULT_VNP_URL =
  "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";

/**
 * VNPay expects yyyyMMddHHmmss in GMT+7. Render (and most hosts) run UTC, so the
 * offset is applied explicitly rather than relying on the process timezone or on
 * toLocaleString with a zone name.
 */
export const formatVnpayDate = (date: Date): string => {
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");

  return [
    gmt7.getUTCFullYear(),
    pad(gmt7.getUTCMonth() + 1),
    pad(gmt7.getUTCDate()),
    pad(gmt7.getUTCHours()),
    pad(gmt7.getUTCMinutes()),
    pad(gmt7.getUTCSeconds()),
  ].join("");
};

/**
 * The single encoder shared by signing and verification. Divergence between the
 * two is the classic VNPay integration bug, as is forgetting that VNPay encodes
 * spaces as "+" rather than "%20".
 */
export const buildSignData = (params: Record<string, string>): string =>
  Object.keys(params)
    .sort()
    .map(
      (key) =>
        `${key}=${encodeURIComponent(String(params[key])).replace(/%20/g, "+")}`,
    )
    .join("&");

export const signVnpayParams = (
  params: Record<string, string>,
  hashSecret: string,
): string =>
  crypto
    .createHmac("sha512", hashSecret)
    .update(Buffer.from(buildSignData(params), "utf-8"))
    .digest("hex");

const safeCompareHex = (left: string, right: string): boolean => {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  try {
    // timingSafeEqual throws on length mismatch, hence the guard above.
    return crypto.timingSafeEqual(
      Buffer.from(left, "hex"),
      Buffer.from(right, "hex"),
    );
  } catch {
    return false;
  }
};

export const vnpayProvider: PaymentProvider = {
  name: "VNPAY",

  createPaymentUrl(input: CreatePaymentInput): string {
    const tmnCode = process.env.VNP_TMN_CODE?.trim() || "";
    const hashSecret = process.env.VNP_HASH_SECRET?.trim() || "";
    const payUrl = process.env.VNP_URL?.trim() || DEFAULT_VNP_URL;

    const params: Record<string, string> = {
      vnp_Version: VNP_VERSION,
      vnp_Command: "pay",
      vnp_TmnCode: tmnCode,
      // VNPay works in the smallest currency unit: VND x 100.
      vnp_Amount: String(input.amountVnd * 100),
      vnp_CurrCode: "VND",
      vnp_TxnRef: input.orderRef,
      vnp_OrderInfo: input.orderInfo,
      vnp_OrderType: "other",
      vnp_Locale: input.locale,
      vnp_ReturnUrl: input.returnUrl,
      vnp_IpAddr: input.ipAddress,
      vnp_CreateDate: formatVnpayDate(new Date()),
      vnp_ExpireDate: formatVnpayDate(input.expiresAt),
    };

    const signData = buildSignData(params);
    const secureHash = signVnpayParams(params, hashSecret);

    return `${payUrl}?${signData}&vnp_SecureHash=${secureHash}`;
  },

  verifyCallback(query: Record<string, string>): PaymentCallbackResult {
    const hashSecret = process.env.VNP_HASH_SECRET?.trim() || "";
    const received = query.vnp_SecureHash || "";

    const params: Record<string, string> = { ...query };
    // Both must go: VNPay sometimes sends vnp_SecureHashType, and including it
    // in the sign string breaks every callback.
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;

    const expected = signVnpayParams(params, hashSecret);
    const signatureValid = safeCompareHex(received, expected);

    return {
      orderRef: query.vnp_TxnRef || "",
      success:
        signatureValid &&
        query.vnp_ResponseCode === "00" &&
        query.vnp_TransactionStatus === "00",
      amountVnd: Number(query.vnp_Amount || 0),
      providerTxnRef: query.vnp_TransactionNo || "",
      responseCode: query.vnp_ResponseCode || "",
      bankCode: query.vnp_BankCode || "",
      signatureValid,
      raw: query,
    };
  },
};
