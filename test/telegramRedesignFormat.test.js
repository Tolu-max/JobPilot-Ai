import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  sendAutoApplyNotification,
  sendReviewNotification,
  sendRunReviewDigest
} from '../src/telegramBot.js';
import { buildConfig } from '../src/config.js';
import { localMatchJob } from '../src/localMatcher.js';
import { evaluateHistoricalCluster, ClusterTier } from '../src/matching/historicalClusterEvaluator.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';

function createMockTelegramConfig(profile = 'tolu') {
  const sentMessages = [];
  const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
  config.telegramBotToken = '123456:MOCK_TOKEN';
  config.telegramChatId = profile === 'sister' ? '987654' : '123456';
  config.applicantEmail = profile === 'sister' ? 'temmy152000@gmail.com' : 'toluoyelola066@gmail.com';
  config.telegramReviewMinScore = 80;
  // sendReviewNotification persists dedupe state to <profileDir>/telegramState.json.
  // Point it at a throwaway directory so tests never read or write the real
  // profiles/<name> data on disk.
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), `jobpilot-telegram-test-${crypto.randomUUID()}-`));
  config.profileDir = tempProfileDir;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('api.telegram.org')) {
      const payload = JSON.parse(options.body || '{}');
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101 } }),
        text: async () => JSON.stringify({ ok: true })
      };
    }
    return originalFetch(url, options);
  };

  return {
    config,
    sentMessages,
    restore: () => {
      globalThis.fetch = originalFetch;
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
  };
}

test('Telegram Format 1: AUTO-APPLIED (Score >= 85)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'Technical WordPress & SEO Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428',
      cluster: { clusterName: 'WordPress & Technical SEO', tier: 'PROVEN_WINNER' }
    };
    const analysis = { score: 90, cluster: job.cluster };

    await sendAutoApplyNotification(job, analysis, config, 'success');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;

    assert.ok(msg.includes('🟢 <b>JOBPILOT • APPLIED</b>'));
    assert.ok(msg.includes('👤 Tolu'));
    assert.ok(msg.includes('📌 Technical WordPress &amp; SEO Specialist') || msg.includes('Technical WordPress'));
    assert.ok(msg.includes('🏢 BruntWork'));
    assert.ok(msg.includes('📊 90/100 • WordPress &amp; Technical SEO') || msg.includes('WordPress & Technical SEO'));
    assert.ok(msg.includes('WordPress') && msg.includes('SEO Specialist'));
    assert.ok(msg.includes('✅ Submitted'));
    assert.ok(msg.includes('🔗 https://apply.bruntworkcareers.co/jobs/10428'));
  } finally {
    restore();
  }
});

test('Telegram Format 2: REVIEW — score 70–84', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_rev_78',
      title: 'Full-Stack PHP Developer',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10430',
      cluster: { clusterName: 'PHP & Laravel Full-Stack', tier: 'SELECTIVE_FIT' },
      matchedSkills: ['PHP', 'Laravel', 'MySQL']
    };

    await sendReviewNotification(job, 78, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;

    assert.ok(msg.includes('🟡 <b>JOBPILOT • REVIEW</b>'));
    assert.ok(msg.includes('👤 Tolu'));
    assert.ok(msg.includes('📌 Full-Stack PHP Developer'));
    assert.ok(msg.includes('🏢 BruntWork'));
    assert.ok(msg.includes('📊 78/100 • PHP &amp; Laravel Full-Stack') || msg.includes('PHP & Laravel Full-Stack'));
    assert.ok(msg.includes('📄 Full Stack Web Developer'));
    assert.ok(msg.includes('🔎'));
    assert.ok(msg.includes('PHP') || msg.includes('Laravel'));
    assert.ok(msg.includes('🔗 https://apply.bruntworkcareers.co/jobs/10430'));

    const buttons = sentMessages[0].reply_markup?.inline_keyboard;
    assert.equal(buttons.length, 2, 'Must have Apply/Skip row plus Full Description row');
    assert.equal(buttons[0][0].text, 'APPLY');
    assert.equal(buttons[0][1].text, 'SKIP');
    assert.equal(buttons[1][0].text, 'Full Description');
  } finally {
    restore();
  }
});

test('Telegram Format 3: REVIEW — score 50–69', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      job_hash: 'hash_rev_58',
      title: 'Junior Web Specialist',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10435',
      cluster: { clusterName: 'General Web & Technical Support', tier: 'SELECTIVE_FIT' }
    };

    await sendReviewNotification(job, 58, config);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;

    assert.ok(msg.includes('🔵 <b>JOBPILOT • REVIEW</b>'));
    assert.ok(msg.includes('👤 Tolu'));
    assert.ok(msg.includes('📌 Junior Web Specialist'));
    assert.ok(msg.includes('🏢 BruntWork'));
    assert.ok(msg.includes('📊 58/100 • Possible Fit'));
    assert.ok(msg.includes('⚠️ Weak historical fit'));
    assert.ok(msg.includes('🔗 https://apply.bruntworkcareers.co/jobs/10435'));

    const buttons = sentMessages[0].reply_markup?.inline_keyboard;
    assert.equal(buttons.length, 2, 'Must have Apply/Skip row plus Full Description row');
    assert.equal(buttons[0][0].text, 'APPLY');
    assert.equal(buttons[0][1].text, 'SKIP');
    assert.equal(buttons[1][0].text, 'Full Description');
  } finally {
    restore();
  }
});

test('Telegram Format 4: APPLICATION FAILED (Human-readable error, no raw adapter names)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress Developer',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428',
      cluster: { clusterName: 'WordPress & Technical SEO', tier: 'PROVEN_WINNER' }
    };
    const analysis = { score: 90, cluster: job.cluster };

    // Test with technical internal error string
    await sendAutoApplyNotification(job, analysis, config, 'failed', 'Error: stuck at step DETAILS, adapter bruntwork timed out');
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;

    assert.ok(msg.includes('🔴 <b>JOBPILOT • FAILED</b>'));
    assert.ok(msg.includes('👤 Tolu'));
    assert.ok(msg.includes('📌 WordPress Developer'));
    assert.ok(msg.includes('🏢 BruntWork'));
    assert.ok(msg.includes('❌ Application not submitted'));
    assert.ok(msg.includes('⚠️ Application request timed out.'));
    assert.ok(!msg.includes('stuck at step DETAILS'), 'Must NOT contain internal step debug details');
    assert.ok(!msg.includes('adapter bruntwork'), 'Must NOT contain raw adapter names');
  } finally {
    restore();
  }
});

test('Starting status spam is suppressed (Single concise failure notification)', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('tolu');
  try {
    const job = {
      title: 'WordPress Developer',
      company: 'BruntWork',
      applicationUrl: 'https://apply.bruntworkcareers.co/jobs/10428',
      cluster: { clusterName: 'WordPress & Technical SEO', tier: 'PROVEN_WINNER' }
    };
    const analysis = { score: 90, cluster: job.cluster };

    // 'starting' must be silently ignored
    await sendAutoApplyNotification(job, analysis, config, 'starting');
    assert.equal(sentMessages.length, 0, 'Starting notification must produce 0 messages');

    // Only 'failed' sends the single notification
    await sendAutoApplyNotification(job, analysis, config, 'failed', 'CAPTCHA verification timeout');
    assert.equal(sentMessages.length, 1, 'Failed status must produce exactly 1 notification');
  } finally {
    restore();
  }
});

test('Replay Case 1: Short-Term Rental Revenue Manager (PriceLabs) is NOT Auto-Applied', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const job = {
    title: 'Short-Term Rental Revenue Manager (PriceLabs)',
    company: 'BruntWork',
    description: 'Manage pricing strategies, revenue optimization using PriceLabs, Airbnb listing management, and occupancy forecasting.',
    requirements: 'PriceLabs, Airbnb, Revenue Management, OTA platforms'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.HARD_EXCLUSION);

  const local = await localMatchJob(job, { name: 'Tolu', profileName: 'tolu' }, config);
  assert.equal(local.score, 0);
  assert.equal(local.recommendation, 'ignore');

  const optimizer = optimizeApplication({
    job,
    candidateProfile: { name: 'Tolu', profileName: 'tolu' },
    localAnalysis: local,
    config
  });

  assert.notEqual(optimizer.recommendation, 'apply', 'Must NOT be auto-applied');
  assert.ok(optimizer.application_score < 50, `Expected score < 50, got ${optimizer.application_score}`);
});

test('Replay Case 2: Social Media Manager (Content, Community & Growth) is NOT Auto-Applied', async () => {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const job = {
    title: 'Social Media Manager (Content, Community & Growth)',
    company: 'BruntWork',
    description: 'Create social media content, schedule posts across Instagram, TikTok, LinkedIn, grow organic reach, and engage community.',
    requirements: 'Social Media Management, Canva, Copywriting, Community Management'
  };

  const cluster = evaluateHistoricalCluster(job, 'tolu');
  assert.equal(cluster.tier, ClusterTier.HARD_EXCLUSION);

  const local = await localMatchJob(job, { name: 'Tolu', profileName: 'tolu' }, config);
  assert.equal(local.score, 0);
  assert.equal(local.recommendation, 'ignore');

  const optimizer = optimizeApplication({
    job,
    candidateProfile: { name: 'Tolu', profileName: 'tolu' },
    localAnalysis: local,
    config
  });

  assert.notEqual(optimizer.recommendation, 'apply', 'Must NOT be auto-applied');
  assert.ok(optimizer.application_score < 50, `Expected score < 50, got ${optimizer.application_score}`);
});

test('Run Review Digest: Silently suppresses review notifications for jobs with score < 80', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const jobs = [
      { title: 'Data Entry Assistant', score: 65, company: 'Acme', job_url: 'https://example.com/1' },
      { title: 'Office Support', score: 55, company: 'Beta', job_url: 'https://example.com/2' }
    ];
    await sendRunReviewDigest(config, jobs);
    assert.equal(sentMessages.length, 0, 'Must not send any messages when all review jobs score < 80');
  } finally {
    restore();
  }
});

test('Run Review Digest: Sends single consolidated digest card with per-job buttons for jobs >= 80', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const jobs = [
      { title: 'Customer Experience Specialist', score: 86, company: 'CareHub', job_url: 'https://example.com/cx' },
      { title: 'Appointment Setter', score: 82, company: 'Prime Realty', job_url: 'https://example.com/as' },
      { title: 'Low Match Helper', score: 62, company: 'SkipMe', job_url: 'https://example.com/low' }
    ];
    await sendRunReviewDigest(config, jobs);
    assert.equal(sentMessages.length, 1, 'Must send exactly 1 single digest message for the entire run');
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('New review jobs'), 'Must have review header');
    assert.ok(msg.includes('Sister'), 'Must include profile name');
    assert.ok(msg.includes('Customer Experience Specialist'), 'Must include role 1');
    assert.ok(msg.includes('Appointment Setter'), 'Must include role 2');
    assert.ok(!msg.includes('Low Match Helper'), 'Must exclude job below score 80');

    const buttons = sentMessages[0].reply_markup?.inline_keyboard;
    assert.ok(buttons && buttons.length >= 2, 'Must have per-job button rows');
    // New design: per-job rows ✅ #N  ❌ #N  🔗 #N
    assert.ok(buttons[0][0].text.includes('✅'), 'First row first button is approve');
    assert.ok(buttons[0][1].text.includes('❌'), 'First row second button is skip');
    // High-tier (score=86) should add "Approve High Tier" footer row
    const lastRow = buttons[buttons.length - 1];
    assert.ok(lastRow[0].callback_data.includes('approve_all') && lastRow[0].callback_data.includes(':85'), 'Last row is approve-high-tier at >=85');
  } finally {
    restore();
  }
});

test('Run Review Digest: Formats single job with direct Queue Apply and Skip buttons', async () => {
  const { config, sentMessages, restore } = createMockTelegramConfig('sister');
  try {
    const jobs = [
      { job_hash: 'cx12345678901234', title: 'Customer Experience Specialist', score: 88, company: 'CareHub', job_url: 'https://example.com/cx' }
    ];
    await sendRunReviewDigest(config, jobs);
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    // Single-job card now says "New review job" (not "Review job found")
    assert.ok(msg.includes('New review job'), 'Single job card must include "New review job" header');
    assert.ok(msg.includes('Customer Experience Specialist'));

    const firstRow = sentMessages[0].reply_markup?.inline_keyboard[0];
    // New button order: ✅ Queue Apply  ❌ Skip  🔗 Open
    assert.ok(firstRow[0].callback_data.includes('accept:'), 'First button must be accept/apply');
    assert.ok(firstRow[1].callback_data.includes('reject:'), 'Second button must be reject/skip');
    assert.equal(firstRow[2].url, 'https://example.com/cx', 'Third button must be open link');
  } finally {
    restore();
  }
});

