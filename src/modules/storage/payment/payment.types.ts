export interface CreatePaymentInput {
  orderRef: string;
  providerOrderCode?: number;
  amountVnd: number;
  orderInfo: string;
  ipAddress: string;
  locale: "vn" | "en";
  returnUrl: string;
  cancelUrl?: string;
  expiresAt: Date;
}

export interface PaymentCallbackResult {
  orderRef: string;
  providerOrderCode?: number;
  success: boolean;
  /** Amount in the gateway's own unit (VNPay multiplies VND by 100). */
  amountVnd: number;
  providerTxnRef: string;
  paymentLinkId?: string;
  responseCode: string;
  bankCode: string;
  signatureValid: boolean;
  raw: Record<string, string>;
}

export interface PaymentCreationResult {
  paymentUrl: string;
  paymentLinkId?: string;
}

export interface PaymentProvider {
  readonly name: "PAYOS" | "VNPAY" | "MOCK";
  createPaymentUrl(input: CreatePaymentInput): string | Promise<string>;
  createPayment?(input: CreatePaymentInput): Promise<PaymentCreationResult>;
  verifyCallback(query: Record<string, string>): PaymentCallbackResult;
}
