import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCvData } from '../src/cvParser.js';

test('loadCvData reuses cached resume parsing when the file hash is unchanged', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-cv-cache-'));
  const profileDir = path.join(dir, 'profile');
  const resumePath = path.join(dir, 'resume.pdf');
  const sourceResume = path.resolve(process.cwd(), 'Toluwalope Oyelola CV.pdf');

  await fs.copyFile(sourceResume, resumePath);

  const config = {
    profileDir,
    resumePath,
    profileName: 'tolu'
  };

  const first = await loadCvData(config);
  assert.ok(first);

  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = await loadCvData(config);
  assert.ok(second);

  assert.equal(second._parsedAt, first._parsedAt);
  assert.equal(second.source.hash, first.source.hash);

  const cache = JSON.parse(await fs.readFile(path.join(profileDir, 'cv-data.json'), 'utf8'));
  assert.equal(cache._resumeHash, first.source.hash);
  assert.equal(cache._pdfHash, first.source.hash);
});
