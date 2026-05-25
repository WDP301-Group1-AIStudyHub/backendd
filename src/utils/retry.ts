export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const retryAsync = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 700;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const shouldRetry = options.shouldRetry ?? (() => false);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      const exponentialDelay = Math.min(
        baseDelayMs * 2 ** attempt,
        maxDelayMs,
      );
      const jitter = Math.floor(Math.random() * 150);

      await sleep(exponentialDelay + jitter);
    }
  }

  throw lastError;
};
