import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function clearBruntWorkApplied({ dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data', stamp } = {}) {
  const backupStamp = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  const targets = [
    path.join(dataDir, 'profiles', 'tolu', 'processedJobs.json'),
    path.join(dataDir, 'profiles', 'sister', 'processedJobs.json'),
    path.join(dataDir, 'globalProcessedJobs.json')
  ];
  const results = [];

  for (const file of targets) {
    const raw = await fs.readFile(file, 'utf8');
    const store = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const jobs = Array.isArray(store.jobs) ? store.jobs : [];
    const removed = jobs.filter(isBruntWorkApplied);
    const kept = jobs.filter((job) => !isBruntWorkApplied(job));
    const backup = `${file}.backup-${backupStamp}`;

    await fs.copyFile(file, backup);
    await fs.writeFile(file, `${JSON.stringify({ ...store, jobs: kept }, null, 2)}\n`, 'utf8');
    const result = { file, backup, before: jobs.length, removed: removed.length, after: kept.length };
    results.push(result);
    console.log(`[bruntwork-cleanup] ${JSON.stringify(result)}`);
  }

  return results;
}

function isBruntWorkApplied(job = {}) {
  return job.status === 'applied' && String(job.source_site || job.source || '').toLowerCase() === 'bruntwork';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await clearBruntWorkApplied();
}
