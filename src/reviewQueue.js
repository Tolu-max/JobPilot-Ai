import fs from 'node:fs/promises';
import path from 'node:path';
import { hashJob } from './jobStore.js';

export async function addReviewJob(job, analysis, statusReason, config = {}, applicationData = {}) {
  const filePath = config.reviewPath || path.resolve(process.cwd(), 'review', 'jobs.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    existing = [];
  }

  const record = {
    profile: config.profileName || 'default',
    job_hash: hashJob(job),
    title: job.title,
    company: job.company || '',
    source: job.source_site || job.source || 'unknown',
    score: analysis.score,
    reason: statusReason,
    generatedCoverLetter: analysis.cover_letter || '',
    applicationUrl: job.applicationUrl,
    queuedAt: new Date().toISOString(),
    statusReason,
    job,
    analysis,
    applicationData
  };

  const next = existing.filter((item) => item.job?.applicationUrl !== job.applicationUrl);
  next.push(record);
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export async function removeReviewJob(job, config = {}) {
  const filePath = config.reviewPath || path.resolve(process.cwd(), 'review', 'jobs.json');
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return;
  }

  const next = existing.filter((item) => item.job?.applicationUrl !== job.applicationUrl);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
