import { AsyncLocalStorage } from 'node:async_hooks';
import { getCredentialStatus, getDecryptedKey } from './aiCredential.service';
import { AppError } from '../middlewares/error.middleware';

export interface ResolvedAiCredential {
  apiKey: string;
  source: 'user' | 'platform';
  userId?: string;
  degraded: boolean;
}

export class AiCredentialContextMissing extends Error {
  constructor() {
    super(
      'AiCredentialContextMissing: An operation requiring a Gemini credential was executed outside a runWithCredential context.',
    );
    this.name = 'AiCredentialContextMissing';
  }
}

const storage = new AsyncLocalStorage<ResolvedAiCredential>();

export function runWithCredential<T>(
  resolved: ResolvedAiCredential,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run(resolved, () => Promise.resolve().then(fn));
}

export function requireCredential(): ResolvedAiCredential {
  const store = storage.getStore();
  if (!store) {
    throw new AiCredentialContextMissing();
  }
  return store;
}

export function hasCredentialContext(): boolean {
  return storage.getStore() !== undefined;
}

// Building a platform credential is the only path that touches the platform
// key, and it refuses to hand back an empty one — an unset key must surface
// here rather than as an opaque rejection from Google several layers later.
function platformCredential(
  userId?: string,
  degraded = false,
): ResolvedAiCredential {
  const platformKey = process.env.GEMINI_API_KEY;
  if (!platformKey) {
    throw new AppError(
      'Platform Gemini API key is not configured.',
      500,
      'CREDENTIAL_UNAVAILABLE',
    );
  }

  return { apiKey: platformKey, source: 'platform', userId, degraded };
}

/**
 * Resolves which key a request runs on. This function decides the *source*
 * only; quota enforcement lives solely in `assertQuotaAvailable` so the rule
 * has one implementation and one flag governing it.
 */
export async function resolveCredentialForUser(
  userId?: string,
): Promise<ResolvedAiCredential> {
  if (!userId) {
    return platformCredential();
  }

  const credStatus = await getCredentialStatus(userId);

  // A usable key of the user's own always wins.
  if (credStatus.status === 'valid') {
    const userKey = await getDecryptedKey(userId);
    if (userKey) {
      return { apiKey: userKey, source: 'user', userId, degraded: false };
    }
  }

  // Otherwise the platform key carries the request. A stored key that is
  // failing means this is declared degraded mode rather than plain free-tier.
  return platformCredential(userId, credStatus.status === 'invalid');
}
