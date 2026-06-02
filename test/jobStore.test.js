import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getJobRecord, shouldSkipProcessed, upsertJobRecord } from '../src/jobStore.js';

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
