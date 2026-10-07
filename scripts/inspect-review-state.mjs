import fs from 'node:fs/promises';
import { buildConfig } from '../src/config.js';
import { loadJobStore } from '../src/jobStore.js';

const profileName = String(process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] || 'sister');
const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
const store = await loadJobStore(config);
const statuses = (store.jobs || []).reduce((counts, job) => {
  counts[job.status || 'unknown'] = (counts[job.status || 'unknown'] || 0) + 1;
  return counts;
}, {});
let queue = [];
try {
  queue = JSON.parse(await fs.readFile(config.reviewPath, 'utf8'));
} catch { /* queue may not exist */ }

console.log(`[review-state] profile=${profileName}`);
console.log(`[review-state] profileDir=${config.profileDir}`);
console.log(`[review-state] jobStore=${config.jobStorePath}`);
console.log(`[review-state] reviewPath=${config.reviewPath}`);
console.log(`[review-state] statuses=${JSON.stringify(statuses)}`);
console.log(`[review-state] reviewed=${JSON.stringify((store.jobs || []).filter((job) => ['reviewed', 'pending_apply'].includes(job.status)).map((job) => ({ title: job.title, score: job.score, url: job.applicationUrl || job.job_url })))} `);
console.log(`[review-state] queueForProfile=${JSON.stringify(queue.filter((job) => String(job.profile || '').toLowerCase() === profileName.toLowerCase()).map((job) => ({ title: job.title, score: job.score, url: job.applicationUrl })))} `);
