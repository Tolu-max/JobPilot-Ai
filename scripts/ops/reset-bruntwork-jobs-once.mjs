import fs from 'node:fs/promises';
import path from 'node:path';

const requestId = sanitize(process.env.JOBPILOT_RESET_BRUNTWORK_ID || '');
const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
const markerPath = path.join(dataDir, 'maintenance', `reset-bruntwork-${requestId}.json`);

if (!requestId) {
  console.log('[reset-bruntwork] No JOBPILOT_RESET_BRUNTWORK_ID provided. Exiting.');
  process.exit(0);
}

const existingMarker = await readJson(markerPath);
if (existingMarker?.status === 'completed') {
  console.log(`[reset-bruntwork] ${requestId} already completed; skipping.`);
  process.exit(0);
}

const profiles = ['tolu', 'sister'];
const restagedJobs = [];

for (const profile of profiles) {
  const profilePath = path.join(dataDir, 'profiles', profile, 'processedJobs.json');
  const profileStore = await readJson(profilePath) || { jobs: [] };
  
  let changed = false;
  for (const record of profileStore.jobs || []) {
    if (String(record.source_site || record.source || '').toLowerCase() !== 'bruntwork') continue;
    
    // Only restage failed, manual_review, or reviewed jobs. Do NOT restage applied or ignored jobs.
    if (['failed', 'manual_review', 'reviewed', 'pending_apply', 'pending'].includes(record.status)) {
      restagedJobs.push({ profile, title: record.title, previousStatus: record.status, url: record.job_url || record.applicationUrl });
      
      // Force it to apply again
      record.status = 'pending_apply';
      record.decision = 'apply';
      record.retryCount = 0;
      record.terminal = false;
      record.acceptedViaTelegram = true; // bypass review queue
      record.reason = 'Restaged after BruntWork form fix deployment';
      record.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    await fs.mkdir(path.dirname(markerPath), { recursive: true });
    try {
      await fs.copyFile(profilePath, `${profilePath}.backup-${requestId}`);
    } catch { /* ignore missing */ }
    await fs.writeFile(profilePath, `${JSON.stringify(profileStore, null, 2)}\n`, 'utf8');
  }
}

await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, `${JSON.stringify({
  requestId,
  status: 'completed',
  completedAt: new Date().toISOString(),
  restaged: restagedJobs
}, null, 2)}\n`, 'utf8');

console.log(`[reset-bruntwork] completed ${requestId}: Restaged ${restagedJobs.length} BruntWork jobs across profiles.`);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function sanitize(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}
