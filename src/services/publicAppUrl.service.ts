const DEV_WEB_URL = "http://localhost:5173";
const DEFAULT_MOBILE_SCHEME = "aistudyhub";

const trimTrailingSlashes = (value: string): string =>
  value.trim().replace(/\/+$/, "");

export const getWebAppBaseUrl = (): string =>
  trimTrailingSlashes(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || DEV_WEB_URL,
  );

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
};

export const buildWebDocumentUrl = (documentId: string): string =>
  new URL(`/documents/${documentId}`, `${getWebAppBaseUrl()}/`).toString();

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
