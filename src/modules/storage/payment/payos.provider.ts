import { PayOS, type Webhook } from "@payos/node";
import {
  CreatePaymentInput,
  PaymentCallbackResult,
  PaymentCreationResult,
  PaymentProvider,
} from "./payment.types";

const getPayosClient = (): PayOS => {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();

  if (!clientId || !apiKey || !checksumKey) {
    throw new Error(
      "PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY are required",
    );
  }

  return new PayOS({ clientId, apiKey, checksumKey });
};

export const isPayosConfigured = (): boolean =>
  Boolean(
    process.env.PAYOS_CLIENT_ID?.trim() &&
      process.env.PAYOS_API_KEY?.trim() &&
      process.env.PAYOS_CHECKSUM_KEY?.trim(),
  );

const createPayosPayment = async (
  input: CreatePaymentInput,
): Promise<PaymentCreationResult> => {
  const paymentLink = await getPayosClient().paymentRequests.create({
    orderCode: input.providerOrderCode || 0,
    amount: input.amountVnd,
    description: input.orderInfo.slice(0, 9),
    cancelUrl: input.cancelUrl || input.returnUrl,
    returnUrl: input.returnUrl,
    expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
    items: [
      {
        name: input.orderInfo.slice(0, 25),
        quantity: 1,
        price: input.amountVnd,
      },
    ],
  });
  return {
    paymentUrl: paymentLink.checkoutUrl,
    paymentLinkId: paymentLink.paymentLinkId,
  };
};

export const payosProvider = {
  name: "PAYOS",

  async createPaymentUrl(input: CreatePaymentInput): Promise<string> {
    return (await createPayosPayment(input)).paymentUrl;
  },

  async createPayment(input: CreatePaymentInput): Promise<PaymentCreationResult> {
    return createPayosPayment(input);
  },

  verifyCallback(query: Record<string, string>): PaymentCallbackResult {
    const providerOrderCode = Number(query.orderCode || 0);
    return {
      orderRef: query.orderRef || "",
      providerOrderCode: Number.isFinite(providerOrderCode)
        ? providerOrderCode
        : undefined,
      success: query.status === "PAID" || query.code === "00",
      amountVnd: Number(query.amount || 0),
      providerTxnRef: query.reference || query.id || "",
      responseCode: query.code || "",
      bankCode: query.counterAccountBankId || "",
      signatureValid: false,
      raw: query,
    };
  },
} satisfies PaymentProvider;

export const verifyPayosWebhook = async (
  payload: unknown,
): Promise<PaymentCallbackResult> => {
  const webhook = await getPayosClient().webhooks.verify(payload as Webhook);
  return {
    orderRef: "",
    providerOrderCode: webhook.orderCode,
    success: webhook.code === "00",
    amountVnd: webhook.amount,
    providerTxnRef: webhook.reference || webhook.paymentLinkId,
    paymentLinkId: webhook.paymentLinkId,
    responseCode: webhook.code,
    bankCode: webhook.counterAccountBankId || "",
    signatureValid: true,
    raw: {
      orderCode: String(webhook.orderCode),
      amount: String(webhook.amount),
      code: webhook.code,
      reference: webhook.reference || "",
      paymentLinkId: webhook.paymentLinkId,
    },
  };
};

export { getPayosClient };
