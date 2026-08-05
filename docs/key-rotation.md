# BYOK Master Key Rotation Runbook

This document describes the procedure for rotating `AI_CREDENTIAL_ENCRYPTION_KEY` (AES-256-GCM master encryption secret).

## Overview

Stored user API keys in collection `aicredentials` are encrypted using AES-256-GCM. Each record stores:
- `ciphertext`: Base64 encrypted payload
- `iv`: Base64 12-byte initialization vector
- `authTag`: Base64 16-byte authentication tag
- `keyVersion`: Integer key version number (currently `1`)

## Rotation Procedure

1. **Generate New Master Key**
   Generate a new 32-byte random secret encoded as Base64:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. **Add Key Version Support to Deploy Configuration**
   - Keep `AI_CREDENTIAL_ENCRYPTION_KEY_V1` set to the existing key.
   - Set `AI_CREDENTIAL_ENCRYPTION_KEY` (or `AI_CREDENTIAL_ENCRYPTION_KEY_V2`) to the new 32-byte Base64 key.

3. **Run Key Re-encryption Script**
   Execute a migration script to decrypt each record with V1 key and re-encrypt with V2 key (`keyVersion: 2`):
   ```typescript
   // Example migration loop
   const credentials = await AiCredential.find({});
   for (const cred of credentials) {
     const plaintext = decryptWithKeyV1(cred);
     const reencrypted = encryptWithKeyV2(plaintext);
     cred.ciphertext = reencrypted.ciphertext;
     cred.iv = reencrypted.iv;
     cred.authTag = reencrypted.authTag;
     cred.keyVersion = 2;
     await cred.save();
   }
   ```

4. **Verify & Deprecate Old Key**
   - Confirm all records in `aicredentials` are updated to `keyVersion: 2`.
   - Remove `AI_CREDENTIAL_ENCRYPTION_KEY_V1` from production environment variables.
