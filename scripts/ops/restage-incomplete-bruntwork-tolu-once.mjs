import fs from 'node:fs/promises';
import path from 'node:path';

const requestId = sanitize(process.env.JOBPILOT_RESTAGE_INCOMPLETE_BRUNTWORK_ID || '');
const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
const markerPath = path.join(dataDir, 'maintenance', `restage-incomplete-bruntwork-${requestId}.json`);
const titlePatterns = [
  /wordpress.*woocommerce.*developer/i,
  /shopify developer/i,
  /wordpress.*woocommerce.*ai.*content specialist/i
];

if (!requestId) process.exit(0);

const existingMarker = await readJson(markerPath);
if (existingMarker?.status === 'completed') {
  console.log(`[restage-incomplete] ${requestId} already completed; skipping.`);
  process.exit(0);
}

const profilePath = path.join(dataDir, 'profiles', 'tolu', 'processedJobs.json');
const globalPath = path.join(dataDir, 'globalProcessedJobs.json');
const profileStore = await readJson(profilePath) || { jobs: [] };
const globalStore = await readJson(globalPath) || { jobs: [] };
const matchedUrls = new Set();
const restaged = [];

for (const record of profileStore.jobs || []) {
  if (!isTarget(record) || record.status === 'applied') continue;
  matchedUrls.add(record.job_url);
  restaged.push({ title: record.title, previousStatus: record.status, url: record.job_url });
  record.status = 'pending_apply';
  record.decision = 'apply';
  record.retryCount = 0;
  record.terminal = false;
  record.acceptedViaTelegram = true;
  record.reason = 'Restaged once after BruntWork draft was confirmed incomplete by reminder email.';
  record.updatedAt = new Date().toISOString();
}

const keptGlobal = (globalStore.jobs || []).filter((record) => {
  if (record.status === 'applied') return true;
  return !matchedUrls.has(record.job_url) && !isTarget(record);
});

await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.copyFile(profilePath, `${profilePath}.backup-${requestId}`);
await fs.copyFile(globalPath, `${globalPath}.backup-${requestId}`);
await fs.writeFile(profilePath, `${JSON.stringify(profileStore, null, 2)}\n`, 'utf8');
await fs.writeFile(globalPath, `${JSON.stringify({ ...globalStore, jobs: keptGlobal }, null, 2)}\n`, 'utf8');
await fs.writeFile(markerPath, `${JSON.stringify({
  requestId,
  status: 'completed',
  completedAt: new Date().toISOString(),
  restaged,
  removedGlobalNonApplied: (globalStore.jobs || []).length - keptGlobal.length
}, null, 2)}\n`, 'utf8');

console.log(`[restage-incomplete] completed ${requestId}: ${JSON.stringify({ restaged, removedGlobalNonApplied: (globalStore.jobs || []).length - keptGlobal.length })}`);

function isTarget(record = {}) {
  if (String(record.source_site || record.source || '').toLowerCase() !== 'bruntwork') return false;
  return titlePatterns.some((pattern) => pattern.test(String(record.title || '')));
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function sanitize(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}
