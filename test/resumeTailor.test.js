import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tailorResumeAndCoverLetter } from '../src/resumeTailor.js';

test('resume tailor uses aiRouter providers instead of requiring Gemini', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-tailor-'));
  const profileDir = path.join(rootDir, 'profiles', 'tolu');
  await fs.mkdir(profileDir, { recursive: true });

  const result = await tailorResumeAndCoverLetter(
    'job-1',
    'Frontend Developer',
    'Build React and WordPress websites.',
    'Candidate has React, WordPress, HTML and CSS experience.',
    profileDir,
    {
      aiMode: 'MOCK',
      rootDir,
      profileName: 'tolu',
      displayName: 'Tolu',
      aiProvider: 'groq',
      aiDisabledProviders: 'gemini',
      groqApiKey: 'test-groq-key'
    }
  );

  assert.ok(result);
  assert.match(result.coverLetterText, /Mock routed cover letter/);
  await assert.doesNotReject(() => fs.access(result.resumePath));
  await assert.doesNotReject(() => fs.access(result.coverLetterPath));
});
