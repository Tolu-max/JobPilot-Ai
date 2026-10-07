import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSystemSnapshot, listProfiles, readJobHistory } from '../src/dataStore.js';

test('dataStore builds a profile/job snapshot from local files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-store-'));
  const profileDir = path.join(root, 'profiles', 'tolu');
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, 'preferences.json'), JSON.stringify({ displayName: 'Tolu' }), 'utf8');
  await fs.writeFile(path.join(profileDir, 'processedJobs.json'), JSON.stringify({
    jobs: [
      { title: 'SEO Specialist', status: 'applied', updatedAt: new Date().toISOString() },
      { title: 'Support Assistant', status: 'reviewed', updatedAt: new Date().toISOString() }
    ]
  }), 'utf8');

  assert.deepEqual(await listProfiles(root), ['tolu']);

  const snapshot = await getSystemSnapshot(root);
  assert.equal(snapshot.totals.profiles, 1);
  assert.equal(snapshot.totals.jobs, 2);
  assert.equal(snapshot.totals.applied, 1);
  assert.equal(snapshot.totals.reviewed, 1);

  const jobs = await readJobHistory(root);
  assert.equal(jobs[0].profileName, 'tolu');
  assert.equal(jobs[0].displayName, 'Tolu');
});
