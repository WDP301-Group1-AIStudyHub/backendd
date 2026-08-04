import { getPublicApiBaseUrl } from "../../../services/publicAppUrl.service";
import {
  CreatePaymentInput,
  PaymentCallbackResult,
  PaymentProvider,
} from "./payment.types";

/**
 * Stand-in used whenever VNPay credentials are absent. It deliberately routes
 * through the SAME return endpoint as the real provider, so order creation,
 * redirect, settlement, activation, polling and the mobile deep link are all
 * exercised end to end without credentials. Only the HMAC maths and VNPay's own
 * hosted page go untested.
 */
export const mockProvider = {
  name: "MOCK",

  createPaymentUrl(input: CreatePaymentInput): string {
    const url = new URL(
      "/api/storage/payments/mock/checkout",
      `${getPublicApiBaseUrl()}/`,
    );
    url.searchParams.set("orderRef", input.orderRef);
    url.searchParams.set("amount", String(input.amountVnd));
    url.searchParams.set("orderInfo", input.orderInfo);

    return url.toString();
  },

  verifyCallback(query: Record<string, string>): PaymentCallbackResult {
    const success = query.mockResult === "SUCCESS";

    return {
      orderRef: query.vnp_TxnRef || query.orderRef || "",
      providerOrderCode: query.orderCode ? Number(query.orderCode) : undefined,
      success,
      amountVnd: Number(query.vnp_Amount || 0),
      providerTxnRef: query.vnp_TransactionNo || `MOCK-${Date.now()}`,
      responseCode: success ? "00" : "24",
      bankCode: query.vnp_BankCode || "MOCKBANK",
      // Nothing to forge in a mock: the checkout page is served by us and never
      // leaves the origin.
      signatureValid: true,
      raw: query,
    };
  },
} satisfies PaymentProvider;

export const renderMockCheckoutPage = (
  orderRef: string,
  amountVnd: number,
  orderInfo: string,
): string => {
  const returnUrl = new URL(
    "/api/storage/payments/vnpay/return",
    `${getPublicApiBaseUrl()}/`,
  );
  returnUrl.searchParams.set("vnp_TxnRef", orderRef);
  returnUrl.searchParams.set("vnp_Amount", String(amountVnd * 100));

  const successUrl = new URL(returnUrl.toString());
  successUrl.searchParams.set("mockResult", "SUCCESS");
  const cancelUrl = new URL(returnUrl.toString());
  cancelUrl.searchParams.set("mockResult", "CANCELLED");

  const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => {
      const map: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return map[char];
    });

  const amountLabel = new Intl.NumberFormat("vi-VN").format(amountVnd);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Simulated checkout</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#f5f7f6; color:#17201a; padding:24px; }
  .card { width:min(100%, 420px); background:#fff; border:1px solid #e1e6e2;
          border-radius:8px; padding:28px; }
  .tag { display:inline-block; font-size:12px; font-weight:700; letter-spacing:.04em;
         text-transform:uppercase; color:#a15c00; background:#fff8e8;
         padding:4px 10px; border-radius:999px; margin-bottom:16px; }
  h1 { font-size:20px; margin:0 0 6px; }
  dl { margin:20px 0; display:grid; grid-template-columns:auto 1fr; gap:8px 16px; font-size:14px; }
  dt { color:#5f6b63; }
  dd { margin:0; font-weight:600; text-align:right; }
  a.btn { display:block; text-align:center; padding:12px 16px; border-radius:8px;
          text-decoration:none; font-weight:600; font-size:15px; min-height:44px;
          box-sizing:border-box; }
  .primary { background:#2f6b4f; color:#fff; margin-bottom:10px; }
  .ghost { background:#fff; color:#17201a; border:1px solid #e1e6e2; }
  p.note { font-size:12px; color:#5f6b63; margin:18px 0 0; line-height:1.5; }
</style>
</head>
<body>
  <main class="card">
    <span class="tag">Simulated payment gateway</span>
    <h1>Confirm payment</h1>
    <dl>
      <dt>Description</dt><dd>${escapeHtml(orderInfo)}</dd>
      <dt>Order</dt><dd>${escapeHtml(orderRef)}</dd>
      <dt>Amount</dt><dd>${amountLabel} &#8363;</dd>
    </dl>
    <a class="btn primary" href="${escapeHtml(successUrl.toString())}">Pay successfully</a>
    <a class="btn ghost" href="${escapeHtml(cancelUrl.toString())}">Cancel payment</a>
    <p class="note">This page only appears while no payment gateway is configured. No real transaction takes place.</p>
  </main>
</body>
</html>`;
};
