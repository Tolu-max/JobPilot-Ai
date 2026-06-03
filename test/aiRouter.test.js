import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import aiRouter, { TaskTypes } from '../src/aiRouter.js';

test('aiRouter returns mock routed responses without provider calls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-router-'));
  const result = await aiRouter.request({
    taskType: TaskTypes.JOB_VERIFICATION,
    prompt: 'Return JSON',
    profile: { profileName: 'tolu' },
    jobData: { title: 'SEO Specialist', applicationUrl: 'https://example.com/job', localScore: 82 },
    config: {
      aiMode: 'MOCK',
      rootDir: dir,
      profileName: 'tolu'
    }
  });

  assert.match(result.modelUsed, /^groq:/);
  assert.match(result.response, /adjusted_score/);
});

test('aiRouter mock mode can simulate fallback routing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-router-'));
  const result = await aiRouter.request({
    taskType: TaskTypes.APPLICATION_WRITING,
    prompt: 'Return JSON',
    profile: { profileName: 'tolu' },
    jobData: { title: 'SEO Specialist', applicationUrl: 'https://example.com/job', localScore: 92 },
    config: {
      aiMode: 'MOCK',
      rootDir: dir,
      profileName: 'tolu',
      aiRouterForcedFailures: ['groq']
    }
  });

  assert.match(result.modelUsed, /^gemini:/);
  assert.equal(result.fallbackUsed, true);
});

test('aiRouter can prefer Groq and disable Gemini', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-router-'));
  const result = await aiRouter.request({
    taskType: TaskTypes.APPLICATION_WRITING,
    prompt: 'Return JSON',
    profile: { profileName: 'tolu' },
    jobData: { title: 'SEO Specialist', applicationUrl: 'https://example.com/job', localScore: 92 },
    config: {
      aiMode: 'MOCK',
      rootDir: dir,
      profileName: 'tolu',
      aiProvider: 'groq',
      aiDisabledProviders: 'gemini'
    }
  });

  assert.match(result.modelUsed, /^groq:/);
});

test('aiRouter skips verification AI below local score threshold', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-router-'));
  const result = await aiRouter.request({
    taskType: TaskTypes.JOB_VERIFICATION,
    prompt: 'Return JSON',
    profile: { profileName: 'tolu' },
    jobData: { title: 'Low Fit', applicationUrl: 'https://example.com/low', localScore: 40 },
    config: {
      rootDir: dir,
      profileName: 'tolu'
    }
  });

  assert.equal(result.modelUsed, 'local-rules');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.response, /below 55/);
});
