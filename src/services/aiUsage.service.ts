import { AiUsage } from '../models/aiUsage.model';
import { getCredentialStatus } from './aiCredential.service';
import { ResolvedAiCredential } from './aiCredentialContext';
import { AppError } from '../middlewares/error.middleware';

export interface AiUsageResponse {
  period: string;
  used: number;
  limit: number;
  unlimited: boolean;
  degraded: boolean;
  unlimitedReason?: 'byok' | 'exempt';
}

export function getCurrentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export function getFreeTierLimit(): number {
  const envVal = process.env.FREE_TIER_MONTHLY_MESSAGES;
  if (envVal && !isNaN(Number(envVal))) {
    return Number(envVal);
  }
  return 20;
}

export async function getUsage(
  userId: string,
  isAdminExempt: boolean = false,
): Promise<AiUsageResponse> {
  const period = getCurrentPeriod();
  const limit = getFreeTierLimit();

  const [usageDoc, credStatus] = await Promise.all([
    AiUsage.findOne({ userId, period }),
    getCredentialStatus(userId),
  ]);

  const used = usageDoc?.messageCount ?? 0;
  const hasValidKey = credStatus.status === 'valid';
  const hasInvalidKey = credStatus.status === 'invalid';

  const unlimited = hasValidKey || isAdminExempt;
  // Reflects the *current* state only. Deriving this from `degradedCount` would
  // leave the flag stuck on for the rest of the month after a user repairs
  // their key; the count stays on the document for analytics.
  const degraded = hasInvalidKey;

  let unlimitedReason: 'byok' | 'exempt' | undefined;
  if (hasValidKey) {
    unlimitedReason = 'byok';
  } else if (isAdminExempt) {
    unlimitedReason = 'exempt';
  }

  return {
    period,
    used,
    limit,
    unlimited,
    degraded,
    unlimitedReason,
  };
}

export async function recordMessage(
  userId: string,
  options: { degraded?: boolean } = {},
): Promise<void> {
  if (!userId) return;
  const period = getCurrentPeriod();
  const incPayload: Record<string, number> = { messageCount: 1 };
  if (options.degraded) {
    incPayload.degradedCount = 1;
  }

  await AiUsage.findOneAndUpdate(
    { userId, period },
    { $inc: incPayload },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Enforcement is opt-in. Without this, deploying the feature would silently cap
 * every existing account the moment it ships, so turning the cap on stays a
 * deliberate decision rather than a side effect of a release.
 */
export function isQuotaEnforced(): boolean {
  return process.env.ENFORCE_BYOK_QUOTA === 'true';
}

export async function assertQuotaAvailable(
  userId: string,
  context: ResolvedAiCredential,
  isAdmin: boolean = false,
): Promise<void> {
  if (!userId) return;

  // The single enforcement point for the quota rule — the flag is checked here
  // and nowhere else, so it cannot be bypassed by another code path.
  if (!isQuotaEnforced()) return;

  // Keyed users with valid credentials are unlimited
  if (context.source === 'user') {
    return;
  }

  // Admins are exempt from platform caps
  if (isAdmin) {
    return;
  }

  const period = getCurrentPeriod();
  const limit = getFreeTierLimit();
  const usageDoc = await AiUsage.findOne({ userId, period });
  const used = usageDoc?.messageCount ?? 0;

  if (used >= limit) {
    const credStatus = await getCredentialStatus(userId);
    if (credStatus.status === 'invalid') {
      throw new AppError(
        'Monthly free quota exhausted and your custom API key is invalid.',
        429,
        'QUOTA_EXHAUSTED_INVALID_KEY',
      );
    }

    throw new AppError(
      'Monthly free quota exhausted. Add an API key to continue.',
      429,
      'QUOTA_EXHAUSTED_NO_KEY',
    );
  }
}
