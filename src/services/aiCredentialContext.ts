import { AsyncLocalStorage } from 'node:async_hooks';
import {
  getCredentialStatus,
  getDecryptedKey,
  markCredentialInvalid,
} from './aiCredential.service';
import { AppError } from '../middlewares/error.middleware';
import { isProviderAuthFailure } from '../utils/providerError';

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

/**
 * Flips a user's stored key to `invalid` when the provider rejects it, which is
 * what puts the account into degraded mode on the next request. Every model
 * caller routes failures here so the rule has one implementation — the direct
 * `@google/genai` path and the LangChain agent path report the same way.
 *
 * Never throws: a bookkeeping failure must not replace the real error the
 * caller is about to surface.
 */
export async function reportCredentialFailure(error: unknown): Promise<void> {
  if (!hasCredentialContext()) return;

  const cred = requireCredential();
  // The platform key failing is an operations problem, not the user's.
  if (cred.source !== 'user' || !cred.userId) return;

  // A 429 spend cap is not a bad key: disabling the credential over one would
  // strand the user on the free allowance until they noticed and re-saved it.
  if (!isProviderAuthFailure(error)) return;

  await markCredentialInvalid(
    cred.userId,
    error instanceof Error ? error.message : 'Unknown provider error',
  ).catch(() => {});
}
