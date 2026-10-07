import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConfig } from '../../src/config.js';
import { loadOrBuildCandidateProfile } from '../../src/profileParser.js';
import { loadJobStore, upsertJobRecord } from '../../src/jobStore.js';
import { validateLiveSubmitReadiness } from '../../src/pipeline.js';

const requestId = String(process.env.JOBPILOT_REQUEUE_JOBBERMAN_ID || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
const markerPath = path.join(dataDir, 'maintenance', `requeue-accepted-jobberman-${requestId}.json`);

if (!requestId) process.exit(0);
try {
  if ((JSON.parse(await fs.readFile(markerPath, 'utf8'))).status === 'completed') process.exit(0);
} catch { /* first run */ }

const results = [];
for (const profileName of ['tolu', 'sister']) {
  const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
  const profile = await loadOrBuildCandidateProfile(config);
  const store = await loadJobStore(config);
  for (const record of store.jobs || []) {
    if (record.status !== 'reviewed' || record.acceptedViaTelegram !== true) continue;
    if (String(record.source_site || record.source || '').toLowerCase() !== 'jobberman') continue;
    const job = { ...record, source: 'jobberman', source_site: 'jobberman', applicationUrl: record.job_url || record.applicationUrl };
    const gate = await validateLiveSubmitReadiness({ job, profile, existing: record, config });
    if (!gate.ready) {
      results.push({ profile: profileName, title: record.title, status: 'held', reason: gate.reason });
      continue;
    }
    await upsertJobRecord(config, job, 'pending_apply', {
      decision: 'apply',
      acceptedViaTelegram: true,
      skippedBecause: '',
      reason: '',
      retryCount: 0,
      terminal: false,
      requeuedAt: new Date().toISOString()
    });
    results.push({ profile: profileName, title: record.title, status: 'requeued' });
  }
}

await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, `${JSON.stringify({ requestId, status: 'completed', completedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`[requeue-jobberman] ${JSON.stringify(results)}`);
