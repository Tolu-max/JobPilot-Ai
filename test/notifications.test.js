import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { notifyRunSummary } from '../src/notifications.js';

test('notifyRunSummary stays quiet for non-actionable duplicate-only runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'sister',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir
  };

  await notifyRunSummary([], config, {
    jobsScanned: 126,
    jobsDeduped: 124,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'bruntwork', status: 'ok', jobCount: 30 },
      { site: 'remoteok', status: 'ok', jobCount: 30 }
    ]
  });

  assert.equal(sent.length, 0);
});

test('notifyRunSummary sends when there is actionable review work', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'sister',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir
  };

  await notifyRunSummary([], config, {
    jobsScanned: 126,
    jobsDeduped: 125,
    jobsIgnored: 0,
    jobsQueuedForReview: 1,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'bruntwork', status: 'ok', jobCount: 30 }
    ]
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /1 review/);
  assert.doesNotMatch(sent[0].text, /Sites:/);
});

test('notifyRunSummary stays quiet for successful ignored-only runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'sister',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir
  };

  await notifyRunSummary([], config, {
    jobsScanned: 150,
    jobsDeduped: 149,
    jobsIgnored: 1,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'bruntwork', status: 'ok', jobCount: 30 },
      { site: 'influx', status: 'ok', jobCount: 17 },
      { site: 'greenhouse', status: 'ok', jobCount: 2 },
      { site: 'remoteok', status: 'ok', jobCount: 30 },
      { site: 'remotive', status: 'ok', jobCount: 28 },
      { site: 'himalayas', status: 'ok', jobCount: 20 },
      { site: 'jobberman', status: 'ok', jobCount: 3 },
      { site: 'remotejobsorg', status: 'ok', jobCount: 20 }
    ]
  });

  assert.equal(sent.length, 0);
});

test('notifyRunSummary sends when a site is unhealthy even without queued jobs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'tolu',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir
  };

  await notifyRunSummary([], config, {
    jobsScanned: 28,
    jobsDeduped: 28,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'wellfound', status: 'zero', jobCount: 0 }
    ]
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /wellfound: zero, 0 jobs/);
});

test('notifyRunSummary suppresses identical follow-up summaries within cooldown', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'sister',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir,
    telegramRunSummaryCooldownMs: 3600000
  };

  const runSummary = {
    jobsScanned: 126,
    jobsDeduped: 125,
    jobsIgnored: 0,
    jobsQueuedForReview: 1,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'bruntwork', status: 'ok', jobCount: 30 }
    ]
  };

  await notifyRunSummary([], config, runSummary);
  await notifyRunSummary([], config, runSummary);

  assert.equal(sent.length, 1);
});

test('notifyRunSummary stays quiet for healthy fully deduped runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'tolu',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir
  };

  await notifyRunSummary([], config, {
    jobsScanned: 25,
    jobsDeduped: 25,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [
      { site: 'bruntwork', status: 'ok', jobCount: 25 }
    ]
  });

  assert.equal(sent.length, 0);
});

test('notifyRunSummary sends a rate-limited healthy heartbeat when configured', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-notify-'));
  const sent = [];

  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
  };

  const config = {
    profileName: 'sister',
    telegramBotToken: 'token',
    telegramChatId: '123',
    profileDir: dir,
    telegramHealthyRunSummaryIntervalMs: 3600000
  };
  const runSummary = {
    jobsScanned: 63,
    jobsDeduped: 63,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    processingErrors: 0,
    siteResults: [{ site: 'bruntwork', status: 'ok', jobCount: 60 }]
  };

  await notifyRunSummary([], config, runSummary);
  await notifyRunSummary([], config, runSummary);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /63 passed source filters, 0 unseen after dedupe, 63 already processed/);
  assert.match(sent[0].text, /0 applied/);
  assert.match(sent[0].text, /No unseen job passed this profile source filters/);
  assert.match(sent[0].text, /Sources: bruntwork ok \(60\)/);
});
