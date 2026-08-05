import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptSecret,
  decryptSecret,
  CredentialCryptoError,
} from '../utils/credentialCrypto';
import { AiCredential } from '../models/aiCredential.model';
import { getCredentialStatus } from './aiCredential.service';
import {
  runWithCredential,
  requireCredential,
  AiCredentialContextMissing,
} from './aiCredentialContext';

describe('BYOK Crypto & Credential Service', () => {
  it('encrypts and decrypts secret roundtrip correctly', () => {
    const originalKey = 'AIzaSyDemoValidTestKey1234567890';
    const encrypted = encryptSecret(originalKey);

    assert.equal(typeof encrypted.ciphertext, 'string');
    assert.equal(typeof encrypted.iv, 'string');
    assert.equal(typeof encrypted.authTag, 'string');
    assert.equal(encrypted.keyVersion, 1);
    assert.notEqual(encrypted.ciphertext, originalKey);

    const decrypted = decryptSecret(encrypted);
    assert.equal(decrypted, originalKey);
  });

  it('produces unique IVs and ciphertexts for identical plaintexts', () => {
    const key = 'AIzaSySameKeyRepeatedEncryption123';
    const enc1 = encryptSecret(key);
    const enc2 = encryptSecret(key);

    assert.notEqual(enc1.iv, enc2.iv);
    assert.notEqual(enc1.ciphertext, enc2.ciphertext);
    assert.equal(decryptSecret(enc1), key);
    assert.equal(decryptSecret(enc2), key);
  });

  it('throws CredentialCryptoError when authTag is tampered', () => {
    const originalKey = 'AIzaSyTamperTestKey12345';
    const encrypted = encryptSecret(originalKey);

    const tamperedPayload = {
      ...encrypted,
      authTag: Buffer.from('invalidauthtag123').toString('base64'),
    };

    assert.throws(() => decryptSecret(tamperedPayload), CredentialCryptoError);
  });

  it('strips crypto fields when serializing AiCredential model via toJSON', () => {
    const credDoc = new AiCredential({
      userId: '60c25d5c-fe38-4a0b-9495-66d54322f8cc',
      provider: 'gemini',
      ciphertext: 'secretCiphertext',
      iv: 'secretIv',
      authTag: 'secretAuthTag',
      keyVersion: 1,
      last4: '1234',
      status: 'valid',
    });

    const json = credDoc.toJSON();
    assert.equal((json as any).ciphertext, undefined);
    assert.equal((json as any).iv, undefined);
    assert.equal((json as any).authTag, undefined);
    assert.equal((json as any).keyVersion, undefined);
    assert.equal(json.last4, '1234');
    assert.equal(json.status, 'valid');
  });

  it('requireCredential throws AiCredentialContextMissing outside runWithCredential', () => {
    assert.throws(() => requireCredential(), AiCredentialContextMissing);
  });

  it('requireCredential retrieves store inside runWithCredential scope', async () => {
    const mockCred = {
      apiKey: 'test-api-key',
      source: 'user' as const,
      userId: 'user-123',
      degraded: false,
    };

    await runWithCredential(mockCred, () => {
      const retrieved = requireCredential();
      assert.equal(retrieved.apiKey, 'test-api-key');
      assert.equal(retrieved.source, 'user');
      assert.equal(retrieved.userId, 'user-123');
    });
  });
});
