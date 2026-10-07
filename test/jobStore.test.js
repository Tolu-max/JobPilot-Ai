import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getJobRecord, resetProcessedJobs, shouldSkipProcessed, upsertJobRecord } from '../src/jobStore.js';

test('dedupe store records and skips completed jobs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-store-'));
  const config = { jobStorePath: path.join(dir, 'processedJobs.json') };
  const job = { title: 'SEO Specialist', applicationUrl: 'https://example.com/jobs/1' };

  await upsertJobRecord(config, job, 'ignored', { score: 10 });
  const record = await getJobRecord(config, job);

  assert.equal(record.status, 'ignored');
  assert.equal(record.score, 10);
  assert.equal(shouldSkipProcessed(record), true);
});

test('job store preserves explicit retry counts and terminal records stay skipped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-store-'));
  const config = { jobStorePath: path.join(dir, 'processedJobs.json') };
  const job = { title: 'Closed Role', applicationUrl: 'https://example.com/jobs/closed' };

  await upsertJobRecord(config, job, 'pending_apply', { retryCount: 1 });
  let record = await getJobRecord(config, job);
  assert.equal(record.retryCount, 1);

  await upsertJobRecord(config, job, 'failed', { retryCount: 3, terminal: true });
  record = await getJobRecord(config, job);
  assert.equal(record.retryCount, 3);
  assert.equal(record.terminal, true);
  assert.equal(shouldSkipProcessed(record), true);
});

test('resetProcessedJobs removes retryable records but preserves applied jobs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-store-'));
  const config = { profileName: 'tolu', jobStorePath: path.join(dir, 'processedJobs.json') };

  await upsertJobRecord(config, { title: 'Applied', applicationUrl: 'https://example.com/applied' }, 'applied', { score: 95 });
  await upsertJobRecord(config, { title: 'Ignored', applicationUrl: 'https://example.com/ignored' }, 'ignored', { score: 20 });
  await upsertJobRecord(config, { title: 'Reviewed', applicationUrl: 'https://example.com/reviewed' }, 'reviewed', { score: 80 });
  await upsertJobRecord(config, { title: 'Failed', applicationUrl: 'https://example.com/failed' }, 'failed', { reason: 'AI provider failed' });

  const result = await resetProcessedJobs(config);
  const store = JSON.parse(await fs.readFile(config.jobStorePath, 'utf8'));

  assert.equal(result.before, 4);
  assert.equal(result.removed, 3);
  assert.equal(store.jobs.length, 1);
  assert.equal(store.jobs[0].status, 'applied');
  assert.equal(store.resetHistory[0].mode, 'retryable');
});

test('resetProcessedJobs allNonApplied also removes skipped and duplicate records', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-store-'));
  const config = { profileName: 'sister', jobStorePath: path.join(dir, 'processedJobs.json') };

  await upsertJobRecord(config, { title: 'Applied', applicationUrl: 'https://example.com/applied' }, 'applied');
  await upsertJobRecord(config, { title: 'Skipped', applicationUrl: 'https://example.com/skipped' }, 'skipped');
  await upsertJobRecord(config, { title: 'Duplicate', applicationUrl: 'https://example.com/duplicate' }, 'duplicate');

  const result = await resetProcessedJobs(config, { allNonApplied: true });
  const store = JSON.parse(await fs.readFile(config.jobStorePath, 'utf8'));

  assert.equal(result.removed, 2);
  assert.equal(store.jobs.length, 1);
  assert.equal(store.jobs[0].status, 'applied');
  assert.equal(store.resetHistory[0].mode, 'all-non-applied');
});
