import fs from 'node:fs/promises';
import path from 'node:path';

const site = sanitize(process.env.JOBPILOT_RESET_SITE || '');
const requestId = sanitize(process.env.JOBPILOT_RESET_SITE_ID || '');
const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';

if (!site || !requestId) {
  console.log('[reset-site] Missing JOBPILOT_RESET_SITE or JOBPILOT_RESET_SITE_ID; skipping.');
  process.exit(0);
}

const markerPath = path.join(dataDir, 'maintenance', `reset-site-${site}-${requestId}.json`);
if ((await readJson(markerPath))?.status === 'completed') {
  console.log(`[reset-site] ${site}/${requestId} already completed; skipping.`);
  process.exit(0);
}

const targets = [
  ...['tolu', 'sister'].map((profile) => path.join(dataDir, 'profiles', profile, 'processedJobs.json')),
  path.join(dataDir, 'globalProcessedJobs.json')
];
const results = [];

for (const file of targets) {
  const store = await readJson(file);
  if (!store) continue;
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  const removed = jobs.filter((record) => matchesSite(record, site) && !isConfirmedApplication(record));
  const kept = jobs.filter((record) => !(matchesSite(record, site) && !isConfirmedApplication(record)));
  if (!removed.length) {
    results.push({ file, before: jobs.length, removed: 0, after: jobs.length });
    continue;
  }

  const backup = `${file}.backup-reset-${site}-${requestId}`;
  await fs.copyFile(file, backup);
  await fs.writeFile(file, `${JSON.stringify({ ...store, jobs: kept }, null, 2)}\n`, 'utf8');
  results.push({ file, before: jobs.length, removed: removed.length, after: kept.length, backup });
}

await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, `${JSON.stringify({ site, requestId, status: 'completed', completedAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
console.log(`[reset-site] completed ${site}/${requestId}: ${JSON.stringify(results)}`);

function matchesSite(record, expected) {
  return String(record?.source_site || record?.source || '').trim().toLowerCase() === expected;
}

function isConfirmedApplication(record) {
  return /applied|submitted|success/i.test(String(record?.status || '')) || record?.applicationSubmitted === true;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
}
