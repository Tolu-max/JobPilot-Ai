import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addReviewJob, removeReviewJob } from '../src/reviewQueue.js';

test('confirmed application can be removed from review queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-queue-'));
  const config = { reviewPath: path.join(dir, 'jobs.json') };
  const job = { title: 'SEO Specialist', applicationUrl: 'https://example.com/jobs/seo' };

  await addReviewJob(job, { score: 90 }, 'Needs review', config, { finalState: 'NEEDS_MANUAL_REVIEW' });
  let records = JSON.parse(await fs.readFile(config.reviewPath, 'utf8'));
  assert.equal(records.length, 1);

  await removeReviewJob(job, config);
  records = JSON.parse(await fs.readFile(config.reviewPath, 'utf8'));
  assert.equal(records.length, 0);
});
