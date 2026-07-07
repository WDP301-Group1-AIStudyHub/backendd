import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildMobileDocumentUrl,
  buildMobileRegistrationUrl,
  buildWebDocumentUrl,
  buildWebRegistrationUrl,
  validateProductionPublicUrls,
} from "./publicAppUrl.service";

const originalEnv = {
  CLIENT_URL: process.env.CLIENT_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  MOBILE_APP_SCHEME: process.env.MOBILE_APP_SCHEME,
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
});
