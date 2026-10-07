import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/retry.js';

test('withRetry stops immediately when a failure is non-retryable', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(async () => {
      attempts += 1;
      const error = new Error('blocked');
      error.status = 403;
      throw error;
    }, { retries: 5, delayMs: 1, shouldRetry: (error) => error.status !== 403 }),
    /blocked/
  );
  assert.equal(attempts, 1);
});
