import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findJobByHash, sendOutcomeNotification, sendDailySummary, sendPendingReviews } from '../src/telegramBot.js';
import { hashJob } from '../src/jobStore.js';

function stubFetch(sent) {
  globalThis.fetch = async (_url, options = {}) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) };
  };
}

test('sendOutcomeNotification sends a clean interview alert and summary', async () => {
  const sent = [];
  stubFetch(sent);
  const config = { profileName: 'tolu', telegramBotToken: 'token', telegramChatId: '123' };
  const job = { title: 'Backend Engineer', company: 'Acme', job_url: 'https://x.test/job' };

  await sendOutcomeNotification(job, 'interview_requested', 'They want a call next week.', config);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Interview requested/);
  assert.match(sent[0].text, /Backend Engineer @ Acme/);
  assert.match(sent[0].text, /They want a call next week\./);
  assert.doesNotMatch(sent[0].text, /[^\x00-\x7F]/);
  assert.equal(sent[0].parse_mode, 'HTML');
});

test('sendOutcomeNotification escapes HTML in job fields', async () => {
  const sent = [];
  stubFetch(sent);
  const config = { profileName: 'tolu', telegramBotToken: 'token', telegramChatId: '123' };
  const job = { title: 'Dev <script>', company: 'A & B' };

  await sendOutcomeNotification(job, 'rejected', 'Not moving forward.', config);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Application rejected/);
  assert.doesNotMatch(sent[0].text, /<script>/);
  assert.match(sent[0].text, /&lt;script&gt;/);
  assert.match(sent[0].text, /A &amp; B/);
  assert.doesNotMatch(sent[0].text, /[^\x00-\x7F]/);
});

test('sendOutcomeNotification stays silent without a chat id', async () => {
  const sent = [];
  stubFetch(sent);
  await sendOutcomeNotification({ title: 'X' }, 'rejected', 'No.', { telegramBotToken: 'token' });
  assert.equal(sent.length, 0);
});

test('sendDailySummary includes approve buttons when reviewed jobs exist', async () => {
  const sent = [];
  stubFetch(sent);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-daily-'));
  const jobStorePath = path.join(dir, 'processedJobs.json');
  const job = {
    title: 'Frontend Engineer', company: 'Acme', source_site: 'linkedin',
    applicationUrl: 'https://example.com/job', status: 'reviewed', score: 85,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(jobStorePath, JSON.stringify({ jobs: [job] }, null, 2), 'utf8');
  const config = { profileName: 'tolu', displayName: 'Tolu', telegramBotToken: 'token', telegramChatId: '123', jobStorePath };

  await sendDailySummary(config);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, '123');
  assert.match(sent[0].text, /Daily Summary/);
  assert.doesNotMatch(sent[0].text, /[^\x00-\x7F]/);
  assert.equal(sent[0].reply_markup.inline_keyboard.length, 1);
  assert.equal(sent[0].reply_markup.inline_keyboard[0].length, 2);
  assert.match(sent[0].reply_markup.inline_keyboard[0][0].callback_data, /^approve_all:tolu:80$/);
  assert.match(sent[0].reply_markup.inline_keyboard[0][1].callback_data, /^approve_top:tolu:noop$/);
  assert.doesNotMatch(sent[0].reply_markup.inline_keyboard[0][0].text, /[^\x00-\x7F]/);
});

test('sendDailySummary omits buttons when no reviewed jobs exist', async () => {
  const sent = [];
  stubFetch(sent);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-daily-'));
  const jobStorePath = path.join(dir, 'processedJobs.json');
  await fs.writeFile(jobStorePath, JSON.stringify({ jobs: [] }, null, 2), 'utf8');
  const config = { profileName: 'tolu', displayName: 'Tolu', telegramBotToken: 'token', telegramChatId: '123', jobStorePath };

  await sendDailySummary(config);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].reply_markup, undefined);
  assert.doesNotMatch(sent[0].text, /approve_all/);
});

test('findJobByHash resolves short Telegram hashes from the review queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-telegram-'));
  const reviewPath = path.join(dir, 'jobs.json');
  const jobStorePath = path.join(dir, 'processedJobs.json');
  const job = { title: 'Customer Support Specialist', company: 'Acme', source_site: 'bruntwork', applicationUrl: 'https://bruntworkcareers.co/jobs/123' };
  const jobHash = hashJob(job);
  await fs.writeFile(jobStorePath, JSON.stringify({ jobs: [] }), 'utf8');
  await fs.writeFile(reviewPath, JSON.stringify([{ profile: 'sister', job_hash: jobHash, title: job.title, company: job.company, source: job.source_site, score: 82, applicationUrl: job.applicationUrl, generatedCoverLetter: 'Hello', job, analysis: { score: 82, application_answers: { why_apply: 'Fit' } } }]), 'utf8');

  const record = await findJobByHash({ profileName: 'sister', jobStorePath, reviewPath }, jobHash.slice(0, 16));

  assert.equal(record.title, job.title);
  assert.equal(record.applicationUrl, job.applicationUrl);
  assert.equal(record.job_url, job.applicationUrl);
  assert.equal(record.cover_letter, 'Hello');
  assert.deepEqual(record.application_answers, { why_apply: 'Fit' });
});

test('pending reviews expose direct open, apply, and skip actions', async () => {
  const sent = [];
  stubFetch(sent);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-telegram-actions-'));
  const job = { job_hash: 'abcdef1234567890abcdef1234567890', title: 'Customer Support Specialist', source_site: 'himalayas', job_url: 'https://himalayas.app/jobs/customer-support-specialist', applicationUrl: 'https://himalayas.app/jobs/customer-support-specialist', score: 82, status: 'reviewed' };
  const jobStorePath = path.join(dir, 'processedJobs.json');
  await fs.writeFile(jobStorePath, JSON.stringify({ jobs: [job] }), 'utf8');

  await sendPendingReviews({ profileName: 'sister', displayName: 'Sister', telegramBotToken: 'token', telegramChatId: '123', jobStorePath }, '123');

  const buttons = sent[0].reply_markup.inline_keyboard[0];
  assert.equal(sent[0].parse_mode, 'HTML');
  assert.match(sent[0].text, /<b>Pending reviews<\/b>/);
  assert.equal(buttons[0].url, job.job_url);
  assert.match(buttons[1].callback_data, /^accept:sister:abcdef1234567890$/);
  assert.match(buttons[2].callback_data, /^reject:sister:abcdef1234567890$/);
  assert.doesNotMatch(sent[0].text, /[^\x00-\x7F]/);
  assert.doesNotMatch(buttons[1].text, /[^\x00-\x7F]/);
});
