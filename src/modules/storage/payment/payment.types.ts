export interface CreatePaymentInput {
  orderRef: string;
  amountVnd: number;
  orderInfo: string;
  ipAddress: string;
  locale: "vn" | "en";
  returnUrl: string;
  expiresAt: Date;
}

export interface PaymentCallbackResult {
  orderRef: string;
  success: boolean;
  /** Amount in the gateway's own unit (VNPay multiplies VND by 100). */
  amountVnd: number;
  providerTxnRef: string;
  responseCode: string;
  bankCode: string;
  signatureValid: boolean;
  raw: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: "VNPAY" | "MOCK";
  createPaymentUrl(input: CreatePaymentInput): string;
  verifyCallback(query: Record<string, string>): PaymentCallbackResult;
}
