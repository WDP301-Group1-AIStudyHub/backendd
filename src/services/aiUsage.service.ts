import { AiUsage } from '../models/aiUsage.model';
import { getCredentialStatus } from './aiCredential.service';
import { ResolvedAiCredential } from './aiCredentialContext';
import { AppError } from '../middlewares/error.middleware';

export interface AiUsageResponse {
  period: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  unlimited: boolean;
  degraded: boolean;
  unlimitedReason?: 'byok' | 'exempt';
}

/**
 * ISO-8601 week key, e.g. "2026-W32". The allowance is per week (RULE-01), so
 * the period key has to change weekly — a calendar-month key would let a user
 * spend a whole month's worth in the last days of it.
 *
 * ISO weeks start on Monday and week 1 is the one containing the first
 * Thursday, which is why the day is snapped to Thursday before counting.
 */
export function getCurrentPeriod(now: Date = new Date()): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // getUTCDay() is 0 for Sunday; ISO numbers Sunday as 7.
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Start of the next ISO week (Monday 00:00 UTC) — the moment `used` returns to
 * zero. The frontend shows this as the countdown next to the remaining count.
 */
export function getPeriodResetAt(now: Date = new Date()): Date {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (8 - isoDay));

  return date;
}

export function getFreeTierLimit(): number {
  const envVal = process.env.FREE_TIER_WEEKLY_MESSAGES;
  if (envVal && !isNaN(Number(envVal))) {
    return Number(envVal);
  }
  return 15;
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
    remaining: unlimited ? limit : Math.max(0, limit - used),
    resetAt: getPeriodResetAt(),
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
    // Every 429 carries the same shape so the client can render the countdown
    // without caring which of the two reasons it hit.
    const details = { remaining: 0, limit, resetAt: getPeriodResetAt() };
    const credStatus = await getCredentialStatus(userId);
    if (credStatus.status === 'invalid') {
      throw new AppError(
        'Weekly free quota exhausted and your custom API key is invalid.',
        429,
        'QUOTA_EXHAUSTED_INVALID_KEY',
        details,
      );
    }

    throw new AppError(
      'Weekly free quota exhausted. Add an API key to continue.',
      429,
      'QUOTA_EXHAUSTED_NO_KEY',
      details,
    );
  }
}
