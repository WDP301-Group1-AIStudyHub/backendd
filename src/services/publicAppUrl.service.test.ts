import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildMobileDocumentUrl,
  buildMobileRegistrationUrl,
  buildMobileStorageReturnUrl,
  buildWebDocumentUrl,
  buildWebRegistrationUrl,
  resolveMobileStorageReturnUrl,
  validateProductionPublicUrls,
} from "./publicAppUrl.service";

const originalEnv = {
  CLIENT_URL: process.env.CLIENT_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  MOBILE_APP_SCHEME: process.env.MOBILE_APP_SCHEME,
  ALLOW_EXPO_GO_RETURN_URL: process.env.ALLOW_EXPO_GO_RETURN_URL,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("public app URL service", () => {
  it("builds production web and mobile sharing links", () => {
    process.env.FRONTEND_URL = "https://front-end-teal-rho.vercel.app/";
    process.env.MOBILE_APP_SCHEME = "aistudyhub";

    assert.equal(
      buildWebDocumentUrl("doc-1"),
      "https://front-end-teal-rho.vercel.app/documents/doc-1",
    );
    assert.equal(buildMobileDocumentUrl("doc-1"), "aistudyhub://document/doc-1");
    assert.match(
      buildWebRegistrationUrl("token", "invitee@example.com"),
      /^https:\/\/front-end-teal-rho\.vercel\.app\/register\?/,
    );
    assert.match(
      buildMobileRegistrationUrl("token", "invitee@example.com"),
      /^aistudyhub:\/\/register\?/,
    );
  });

  it("rejects localhost or missing frontend URL in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.FRONTEND_URL;
    assert.throws(validateProductionPublicUrls, /FRONTEND_URL is required/);

    process.env.FRONTEND_URL = "http://localhost:5173";
    assert.throws(validateProductionPublicUrls, /public HTTPS URL/);

    process.env.FRONTEND_URL = "https://front-end-teal-rho.vercel.app";
    assert.doesNotThrow(validateProductionPublicUrls);
  });

  it("preserves the mobile runtime callback and adds the payment result", () => {
    process.env.NODE_ENV = "development";
    process.env.MOBILE_APP_SCHEME = "aistudyhub";

    assert.equal(
      resolveMobileStorageReturnUrl(
        "aistudyhub://storage",
        "SPTEST01",
        "COMPLETED",
      ),
      "aistudyhub://storage?orderRef=SPTEST01&status=COMPLETED",
    );

    assert.equal(
      resolveMobileStorageReturnUrl(
        "exp://192.168.0.111:8081/--/storage",
        "SPTEST02",
        "COMPLETED",
      ),
      "exp://192.168.0.111:8081/--/storage?orderRef=SPTEST02&status=COMPLETED",
    );

    assert.equal(
      resolveMobileStorageReturnUrl(
        "https://attacker.example/redirect",
        "SPTEST03",
        "FAILED",
      ),
      buildMobileStorageReturnUrl("SPTEST03", "FAILED"),
    );
  });

  it("allows a private Expo Go callback in production only when explicitly enabled", () => {
    process.env.NODE_ENV = "production";
    process.env.MOBILE_APP_SCHEME = "aistudyhub";
    delete process.env.ALLOW_EXPO_GO_RETURN_URL;

    assert.equal(
      resolveMobileStorageReturnUrl(
        "exp://192.168.0.111:8081/--/storage",
        "SPPROD01",
        "COMPLETED",
      ),
      "aistudyhub://storage?orderRef=SPPROD01&status=COMPLETED",
    );

    process.env.ALLOW_EXPO_GO_RETURN_URL = "true";
    assert.equal(
      resolveMobileStorageReturnUrl(
        "exp://192.168.0.111:8081/--/storage",
        "SPPROD02",
        "COMPLETED",
      ),
      "exp://192.168.0.111:8081/--/storage?orderRef=SPPROD02&status=COMPLETED",
    );

    assert.equal(
      resolveMobileStorageReturnUrl(
        "exp://attacker.example:8081/--/storage",
        "SPPROD03",
        "COMPLETED",
      ),
      "aistudyhub://storage?orderRef=SPPROD03&status=COMPLETED",
    );
  });
});
