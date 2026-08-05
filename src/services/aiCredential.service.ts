import { GoogleGenAI } from "@google/genai";
import { AiCredential, AiProvider } from "../models/aiCredential.model";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto";
import { AppError } from "../middlewares/error.middleware";

export interface AiCredentialStatusResponse {
  provider: AiProvider;
  last4: string | null;
  status: "none" | "valid" | "invalid";
  addedAt: string | null;
  lastValidatedAt: string | null;
}

export async function validateKey(apiKey: string): Promise<void> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey || trimmedKey.length < 8) {
    throw new AppError(
      "API key is too short or invalid.",
      400,
      "CREDENTIAL_INVALID",
    );
  }

  try {
    const client = new GoogleGenAI({ apiKey: trimmedKey });
    await client.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: "ping",
      config: { maxOutputTokens: 1 },
    });
  } catch (err: any) {
    const status = err?.status || err?.statusCode || err?.status_code;
    const message = String(err?.message || "").toLowerCase();

    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      message.includes("api_key") ||
      message.includes("invalid") ||
      message.includes("unauthorized") ||
      message.includes("permission")
    ) {
      throw new AppError(
        "The provided Google API key is invalid or lacks Gemini access.",
        400,
        "CREDENTIAL_INVALID",
      );
    }

    if (
      status === 429 ||
      status === 500 ||
      status === 503 ||
      message.includes("unavailable") ||
      message.includes("quota")
    ) {
      throw new AppError(
        "Google Gemini API is currently unavailable. Please try again later.",
        503,
        "CREDENTIAL_UNAVAILABLE",
        status,
      );
    }

    throw new AppError(
      "The provided Google API key is invalid or lacks Gemini access.",
      400,
      "CREDENTIAL_INVALID",
    );
  }
}

export async function saveCredential(
  userId: string,
  apiKey: string,
  provider: AiProvider = "gemini",
): Promise<AiCredentialStatusResponse> {
  const trimmedKey = apiKey.trim();
  await validateKey(trimmedKey);

  const encrypted = encryptSecret(trimmedKey);
  const last4 = trimmedKey.slice(-4);
  const now = new Date();

  await AiCredential.findOneAndUpdate(
    { userId },
    {
      userId,
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      last4,
      status: "valid",
      lastValidatedAt: now,
      lastFailureAt: null,
      lastFailureReason: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return getCredentialStatus(userId);
}

export async function getCredentialStatus(
  userId: string,
): Promise<AiCredentialStatusResponse> {
  const doc = await AiCredential.findOne({ userId });
  if (!doc) {
    return {
      provider: "gemini",
      last4: null,
      status: "none",
      addedAt: null,
      lastValidatedAt: null,
    };
  }

  return {
    provider: doc.provider,
    last4: doc.last4,
    status: doc.status,
    addedAt: doc.createdAt.toISOString(),
    lastValidatedAt: doc.lastValidatedAt
      ? doc.lastValidatedAt.toISOString()
      : null,
  };
}

export async function getDecryptedKey(userId: string): Promise<string | null> {
  const doc = await AiCredential.findOne({ userId });
  if (!doc || doc.status !== "valid") {
    return null;
  }

  try {
    return decryptSecret({
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      authTag: doc.authTag,
      keyVersion: doc.keyVersion,
    });
  } catch (err) {
    return null;
  }
}

export async function markCredentialInvalid(
  userId: string,
  reason?: string,
): Promise<void> {
  await AiCredential.findOneAndUpdate(
    { userId },
    {
      status: "invalid",
      lastFailureAt: new Date(),
      lastFailureReason: reason || "Key failed during generation request",
    },
  );
}

export async function deleteCredential(userId: string): Promise<void> {
  await AiCredential.deleteOne({ userId });
}
