const DEV_WEB_URL = "http://localhost:5173";
const DEFAULT_MOBILE_SCHEME = "aistudyhub";

const trimTrailingSlashes = (value: string): string =>
  value.trim().replace(/\/+$/, "");

export const getWebAppBaseUrl = (): string =>
  trimTrailingSlashes(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || DEV_WEB_URL,
  );

/**
 * Absolute public origin of this API. VNPay requires the ReturnUrl and IPN URL
 * to be publicly reachable http(s) URLs, so this cannot fall back to a relative
 * path — a misconfigured deploy must fail loudly at startup, not at the first
 * payment.
 */
export const getPublicApiBaseUrl = (): string => {
  const configured = process.env.PUBLIC_API_URL?.trim();

  if (configured) {
    return trimTrailingSlashes(configured);
  }

  const port = process.env.PORT || "5000";
  return `http://localhost:${port}`;
};

export const getMobileAppScheme = (): string =>
  (process.env.MOBILE_APP_SCHEME || DEFAULT_MOBILE_SCHEME)
    .trim()
    .replace(/:\/\/?$/, "");

export const validateProductionPublicUrls = (): void => {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const configuredUrl = process.env.FRONTEND_URL?.trim();
  if (!configuredUrl) {
    throw new Error("FRONTEND_URL is required in production");
  }

  const parsedUrl = new URL(configuredUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    parsedUrl.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    throw new Error(
      "FRONTEND_URL must be a public HTTPS URL in production",
    );
  }

  if (!/^[a-z][a-z0-9+.-]*$/i.test(getMobileAppScheme())) {
    throw new Error("MOBILE_APP_SCHEME is invalid");
  }

  // Only required once a real payment provider is configured; the MOCK provider
  // works fine against localhost.
  if (process.env.VNP_TMN_CODE?.trim()) {
    const publicApiUrl = process.env.PUBLIC_API_URL?.trim();

    if (!publicApiUrl) {
      throw new Error("PUBLIC_API_URL is required when VNPay is configured");
    }

    const parsedApiUrl = new URL(publicApiUrl);
    if (parsedApiUrl.protocol !== "https:") {
      throw new Error("PUBLIC_API_URL must be a public HTTPS URL in production");
    }
  }
};

export const buildWebDocumentUrl = (documentId: string): string =>
  new URL(`/documents/${documentId}`, `${getWebAppBaseUrl()}/`).toString();

export const buildWebSubjectUrl = (subjectId: string): string => {
  const url = new URL("/subjects", `${getWebAppBaseUrl()}/`);
  url.searchParams.set("subjectId", subjectId);
  return url.toString();
};

export const buildWebRegistrationUrl = (
  token: string,
  email: string,
): string => {
  const url = new URL("/register", `${getWebAppBaseUrl()}/`);
  url.searchParams.set("invite", token);
  url.searchParams.set("email", email);
  return url.toString();
};

const buildMobileUrl = (
  route: string,
  params?: Record<string, string>,
): string => {
  const query = new URLSearchParams(params).toString();
  return `${getMobileAppScheme()}://${route}${query ? `?${query}` : ""}`;
};

export const buildMobileDocumentUrl = (documentId: string): string =>
  buildMobileUrl(`document/${encodeURIComponent(documentId)}`);

export const buildMobileRegistrationUrl = (
  token: string,
  email: string,
): string => buildMobileUrl("register", { invite: token, email });

export const buildMobileStorageReturnUrl = (
  orderRef: string,
  status: string,
): string => buildMobileUrl("storage", { orderRef, status });

/**
 * Expo Go/development builds use an exp:// callback while installed builds use
 * the configured app scheme. Keep the exact callback created by the client so
 * openAuthSessionAsync can recognize it and close the Custom Tab.
 */
export const resolveMobileStorageReturnUrl = (
  clientReturnUrl: string | null | undefined,
  orderRef: string,
  status: string,
): string => {
  if (!clientReturnUrl) return buildMobileStorageReturnUrl(orderRef, status);

  try {
    const url = new URL(clientReturnUrl);
    const appProtocol = `${getMobileAppScheme().toLowerCase()}:`;
    const isInstalledApp = url.protocol.toLowerCase() === appProtocol;
    const isExpoDevelopment =
      process.env.NODE_ENV !== "production" &&
      ["exp:", "exps:"].includes(url.protocol.toLowerCase());

    if (!isInstalledApp && !isExpoDevelopment) {
      return buildMobileStorageReturnUrl(orderRef, status);
    }

    url.searchParams.set("orderRef", orderRef);
    url.searchParams.set("status", status);
    return url.toString();
  } catch {
    return buildMobileStorageReturnUrl(orderRef, status);
  }
};

export const buildWebStorageReturnUrl = (
  orderRef: string,
  status: string,
): string => {
  const url = new URL("/storage", `${getWebAppBaseUrl()}/`);
  url.searchParams.set("orderRef", orderRef);
  url.searchParams.set("status", status);
  return url.toString();
};
