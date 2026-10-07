import fs from 'node:fs/promises';
import path from 'node:path';

const profile = sanitize(process.env.JOBPILOT_SKIP_PROFILE || '');
const requestId = sanitize(process.env.JOBPILOT_SKIP_TITLES_ID || '');
const titles = String(process.env.JOBPILOT_SKIP_TITLES || '')
  .split('|')
  .map((title) => title.trim().toLowerCase())
  .filter(Boolean);
const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
const markerPath = path.join(dataDir, 'maintenance', `skip-titles-${profile}-${requestId}.json`);

if (!profile || !requestId || !titles.length) process.exit(0);
if ((await readJson(markerPath))?.status === 'completed') process.exit(0);

const profilePath = path.join(dataDir, 'profiles', profile, 'processedJobs.json');
const store = await readJson(profilePath) || { jobs: [] };
const matches = (record) => titles.includes(String(record.title || '').trim().toLowerCase());
const changed = [];

for (const record of store.jobs || []) {
  if (!matches(record)) continue;
  record.status = 'skipped';
  record.decision = 'skip';
  record.terminal = true;
  record.reason = 'Removed from review: outside Sister target roles.';
  record.skippedBecause = record.reason;
  record.updatedAt = new Date().toISOString();
  changed.push(record.title);
}

if (changed.length) {
  await fs.copyFile(profilePath, `${profilePath}.backup-skip-${requestId}`);
  await fs.writeFile(profilePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

const reviewPath = path.join(dataDir, 'review', 'jobs.json');
const queue = await readJson(reviewPath) || [];
const kept = queue.filter((item) => !(String(item.profile || '').toLowerCase() === profile && matches(item.job || item)));
if (kept.length !== queue.length) await fs.writeFile(reviewPath, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');

await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, `${JSON.stringify({ profile, requestId, status: 'completed', changed }, null, 2)}\n`, 'utf8');
console.log(`[skip-titles] ${profile}/${requestId}: skipped ${changed.length} records`);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function sanitize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
}
