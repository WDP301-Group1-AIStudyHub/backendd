import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import nodemailer from "nodemailer";
import {
  resetEmailTransporterForTests,
  sendDocumentShareEmail,
  validateEmailConfiguration,
} from "./email.service";

const originalCreateTransport = nodemailer.createTransport;
const trackedEnvironment = [
  "EMAIL_REQUIRED",
  "EMAIL_SEND_TIMEOUT_MS",
  "SMTP_FROM",
  "SMTP_HOST",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_USER",
] as const;
const originalEnvironment = Object.fromEntries(
  trackedEnvironment.map((name) => [name, process.env[name]]),
);

const payload = {
  to: "recipient@example.com",
  recipientName: "Recipient",
  senderName: "Owner",
  documentTitle: "Shared handbook",
  permission: "VIEW" as const,
  documentUrl: "https://example.com/documents/123",
};

const setConfiguredEnvironment = () => {
  process.env.SMTP_HOST = "smtp.sendgrid.net";
  process.env.SMTP_PORT = "2525";
  process.env.SMTP_USER = "apikey";
  process.env.SMTP_PASS = "test-api-key";
  process.env.SMTP_FROM = "AI Study Hub <verified@example.com>";
};

afterEach(() => {
  resetEmailTransporterForTests();
  nodemailer.createTransport = originalCreateTransport;
  for (const name of trackedEnvironment) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("email service", () => {
  it("skips delivery when SMTP is not configured", async () => {
    for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      delete process.env[name];
    }

    const result = await sendDocumentShareEmail(payload);

    assert.deepEqual(result, {
      status: "SKIPPED",
      errorCode: "SMTP_NOT_CONFIGURED",
    });
  });

  it("fails startup validation when required SMTP variables are missing", () => {
    setConfiguredEnvironment();
    process.env.EMAIL_REQUIRED = "true";
    delete process.env.SMTP_PASS;

    assert.throws(
      validateEmailConfiguration,
      /Missing required email configuration: SMTP_PASS/,
    );
  });

  it("returns ACCEPTED when the SMTP provider accepts the message", async () => {
    setConfiguredEnvironment();
    nodemailer.createTransport = (() => ({
      close: () => undefined,
      verify: async () => true,
      sendMail: async () => ({ messageId: "sendgrid-message-id" }),
    })) as unknown as typeof nodemailer.createTransport;

    const result = await sendDocumentShareEmail(payload);

    assert.deepEqual(result, {
      status: "ACCEPTED",
      messageId: "sendgrid-message-id",
    });
  });

  it("returns FAILED with a sanitized provider error code", async () => {
    setConfiguredEnvironment();
    nodemailer.createTransport = (() => ({
      close: () => undefined,
      verify: async () => true,
      sendMail: async () => {
        const error = new Error("Authentication details must stay private") as Error & {
          code?: string;
        };
        error.code = "EAUTH";
        throw error;
      },
    })) as unknown as typeof nodemailer.createTransport;

    const result = await sendDocumentShareEmail(payload);

    assert.deepEqual(result, { status: "FAILED", errorCode: "EAUTH" });
  });

  it("bounds a stalled SMTP request with EMAIL_SEND_TIMEOUT_MS", async () => {
    setConfiguredEnvironment();
    process.env.EMAIL_SEND_TIMEOUT_MS = "1000";
    nodemailer.createTransport = (() => ({
      close: () => undefined,
      verify: async () => true,
      sendMail: () => new Promise(() => undefined),
    })) as unknown as typeof nodemailer.createTransport;

    const startedAt = Date.now();
    const result = await sendDocumentShareEmail(payload);

    assert.deepEqual(result, {
      status: "FAILED",
      errorCode: "EMAIL_TIMEOUT",
    });
    assert.ok(Date.now() - startedAt < 2_500);
  });
});
