import { sleep } from './utils.js';

export async function withRetry(task, options = {}) {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 2000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
    }
  }

  throw lastError;
}
