import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

export class CredentialCryptoError extends Error {
  constructor(message: string = 'Failed to decrypt credential secret.') {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_VERSION = 1;

// There is deliberately no fallback key. A hardcoded default would mean a
// deploy that forgets this secret silently encrypts every user's credential
// with a constant committed to the repository — worse than refusing to boot.
function getMasterKey(): Buffer {
  const envKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'AI_CREDENTIAL_ENCRYPTION_KEY environment variable is missing. Startup aborted.',
    );
  }

  const keyBuffer = Buffer.from(envKey, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error(
      'AI_CREDENTIAL_ENCRYPTION_KEY must be a valid 32-byte base64 string.',
    );
  }

  return keyBuffer;
}

// Validated at boot time so misconfiguration fails process immediately.
const MASTER_KEY = getMasterKey();

export interface EncryptedSecretPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export function encryptSecret(plaintext: string): EncryptedSecretPayload {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');

  return {
    ciphertext,
    iv: iv.toString('base64'),
    authTag,
    keyVersion: KEY_VERSION,
  };
}

export function decryptSecret(payload: EncryptedSecretPayload): string {
  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);

    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(payload.ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (err: any) {
    throw new CredentialCryptoError();
  }
}
