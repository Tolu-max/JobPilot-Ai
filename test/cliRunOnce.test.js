import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResults } from '../src/cli/runOnce.js';

test('run-once summary does not count historical dedupes as newly applied', () => {
  const rows = [
    { title: 'Previously applied A', status: 'applied', decision: 'apply', deduped: true },
    { title: 'Previously applied B', status: 'applied', decision: 'apply', deduped: true },
    { title: 'Closed pending role', status: 'failed', decision: 'apply' }
  ];
  rows.runSummary = {
    jobsScanned: 3,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplyAttempts: 1,
    jobsAutoApplied: 0,
    jobsDeduped: 2,
    processingErrors: 1,
    errors: []
  };

  assert.deepEqual(summarizeResults(rows, rows.runSummary), {
    scraped: 3,
    ignored: 0,
    queuedReview: 0,
    autoApplyAttempts: 1,
    autoApplied: 0,
    deduped: 2,
    errors: 1
  });
});
