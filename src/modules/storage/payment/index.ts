import { mockProvider } from "./mock.provider";
import { isPayosConfigured, payosProvider } from "./payos.provider";
import { PaymentProvider } from "./payment.types";

/**
 * PayOS is the only real provider for new orders. MOCK is available only when
 * explicitly selected for tests or isolated development.
 */
export const getPaymentProvider = (): PaymentProvider =>
  (() => {
    const requested = process.env.PAYMENT_PROVIDER?.trim().toUpperCase();
    if (requested === "MOCK") return mockProvider;
    if (requested === "PAYOS") {
      if (!isPayosConfigured()) {
        throw new Error(
          "PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY are required",
        );
      }
      return payosProvider;
    }
    if (!requested && isPayosConfigured()) return payosProvider;
    throw new Error("PAYMENT_PROVIDER must be PAYOS or explicit MOCK");
  })();

export const logPaymentProviderSelection = (): void => {
  const provider = getPaymentProvider();

  if (provider.name === "MOCK") {
    console.warn(
      "[storage] Payment provider: MOCK (explicit test/development mode). No real payment will be taken.",
    );
    return;
  }

  console.log(`[storage] Payment provider: ${provider.name}`);
};

export { PaymentProvider } from "./payment.types";
