import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractResumeIntelligence, structureResumeLocally } from '../src/resumeIntelligence.js';

test('local resume intelligence extracts common candidate fields from text', () => {
  const profile = structureResumeLocally(`
    Tolu Oyelola
    Lagos, Nigeria
    tolu@example.com
    https://www.linkedin.com/in/tolu
    SEO Specialist with 5 years of experience in Technical SEO, Shopify, WordPress, and Google Analytics.
    Languages: English
  `);

  assert.equal(profile.name, 'Tolu Oyelola');
  assert.equal(profile.email, 'tolu@example.com');
  assert.equal(profile.location, 'Lagos, Nigeria');
  assert.ok(profile.skills.includes('Technical SEO'));
  assert.ok(profile.industries.includes('Marketing'));
});

test('resume intelligence parses txt files without requiring AI', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-resume-'));
  const resumePath = path.join(dir, 'resume.txt');
  await fs.writeFile(resumePath, 'Jane Doe\njane@example.com\nCustomer Support Specialist with CRM and Google Workspace experience.', 'utf8');

  const result = await extractResumeIntelligence(resumePath, { aiMode: 'MOCK' });

  assert.equal(result.name, 'Jane Doe');
  assert.equal(result.email, 'jane@example.com');
  assert.equal(result.source.type, 'txt');
  assert.equal(result.source.extractionMethod, 'txt-local');
  assert.ok(result.skills.includes('CRM'));
});
