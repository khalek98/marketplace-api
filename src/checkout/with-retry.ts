export interface PgErrorLike extends Error {
  code?: string;
  driverError?: { code?: string };
}

export const asPgError = (e: unknown): PgErrorLike => e as PgErrorLike;

export function pgErrorCode(e: unknown): string | undefined {
  const err = asPgError(e);
  return err.code ?? err.driverError?.code;
}

const RETRYABLE = new Set(["40001", "40P01"]);

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const code = pgErrorCode(e);
      if (code !== undefined && RETRYABLE.has(code) && attempt < maxAttempts) {
        const backoff = Math.round(2 ** attempt * 25 + Math.random() * 25);
        console.log(`[${label}] спроба ${attempt} впала: ${code} → retry через ${backoff} мс`);
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
}
