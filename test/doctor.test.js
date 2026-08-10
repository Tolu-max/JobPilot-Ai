import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectProfile } from '../src/cli/doctor.js';

test('doctor warns when resumePath is an absolute machine-specific path outside the profile folder', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-doctor-'));
  const profileDir = path.join(rootDir, 'profiles', 'sister');
  await fs.mkdir(profileDir, { recursive: true });

  await fs.writeFile(path.join(profileDir, 'candidateProfile.json'), '{}');
  await fs.writeFile(path.join(profileDir, 'processedJobs.json'), '[]');
  await fs.writeFile(path.join(profileDir, 'reviewQueue.json'), '[]');
  await fs.writeFile(
    path.join(profileDir, 'preferences.json'),
    JSON.stringify({
      displayName: 'Sister',
      applicantEmail: 'sister@example.com',
      enabledSites: ['bruntwork'],
      resumePath: path.join(rootDir, 'TEMILOLUWA RUTH OYELOLA (CV) - COMPLETE.pdf')
    }, null, 2)
  );

  const report = await inspectProfile(rootDir, 'sister', {
    readResumeTextImpl: async () => '',
    env: {}
  });

  const resumePathCheck = report.checks.find((check) => check.label === 'Resume path');
  assert.ok(resumePathCheck);
  assert.equal(resumePathCheck.status, 'warn');
  assert.match(resumePathCheck.detail, /machine-specific absolute path/i);
});
