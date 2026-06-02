import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectHealth } from '../src/cli/doctor.js';

test('inspectHealth reports a healthy profile when the core files and resume parse cleanly', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-doctor-'));
  const profileDir = path.join(rootDir, 'profiles', 'demo');
  await fs.mkdir(profileDir, { recursive: true });

  await fs.writeFile(path.join(profileDir, 'preferences.json'), JSON.stringify({
    displayName: 'Demo Profile',
    applicantEmail: 'demo@example.com',
    enabledSites: ['bruntwork'],
    resumePath: 'resume.txt'
  }, null, 2));
  await fs.writeFile(path.join(profileDir, 'candidateProfile.json'), JSON.stringify({ name: 'Demo' }, null, 2));
  await fs.writeFile(path.join(profileDir, 'processedJobs.json'), JSON.stringify({ jobs: [] }, null, 2));
  await fs.writeFile(path.join(profileDir, 'resume.txt'), 'Demo resume text');

  const report = await inspectHealth({
    rootDir,
    profileName: 'demo',
    env: {
      GEMINI_API_KEY: 'test-key',
      APPLICANT_EMAIL: 'demo@example.com'
    },
    readResumeTextImpl: async () => 'Demo resume text',
    schedulerStatusImpl: async () => ({ status: 'pass', label: 'Scheduler', detail: 'Running via PM2' })
  });

  assert.equal(report.summary.status, 'pass');
  assert.equal(report.summary.issueCount, 0);
  assert.equal(report.profiles[0].status, 'pass');
  assert.ok(report.profiles[0].checks.some((check) => check.label === 'Resume' && check.status === 'pass'));
  assert.equal(report.environment.status, 'pass');
  assert.equal(report.scheduler.status, 'pass');
});
