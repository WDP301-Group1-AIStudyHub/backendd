import { mockProvider } from "./mock.provider";
import { vnpayProvider } from "./vnpay.provider";
import { PaymentProvider } from "./payment.types";

export const isVnpayConfigured = (): boolean =>
  Boolean(process.env.VNP_TMN_CODE?.trim() && process.env.VNP_HASH_SECRET?.trim());

/**
 * Auto-selects the provider from configuration. Absent credentials means MOCK,
 * so development is never blocked on merchant registration.
 */
export const getPaymentProvider = (): PaymentProvider =>
  isVnpayConfigured() ? vnpayProvider : mockProvider;

export const logPaymentProviderSelection = (): void => {
  const provider = getPaymentProvider();

  if (provider.name === "MOCK") {
    console.warn(
      "[storage] Payment provider: MOCK (VNP_TMN_CODE/VNP_HASH_SECRET not set). No real payment will be taken.",
    );
    return;
  }

  console.log("[storage] Payment provider: VNPAY");
};

export { PaymentProvider } from "./payment.types";
