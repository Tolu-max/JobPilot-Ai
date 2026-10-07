import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  handleTextCommand,
  handleCallback,
  skipAllJobs,
  applyPendingFromTelegram,
  sendStatusMessage,
  sendSitesMessage,
  sendHelpMessage,
  formatApplyQueueSummary
} from '../src/telegramBot.js';
import { buildConfig } from '../src/config.js';

function createMockTelegramContext(profile = 'tolu') {
  const sentMessages = [];
  const answeredCallbacks = [];
  const editedMessages = [];
  const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
  config.telegramBotToken = '123456:MOCK_TOKEN';
  config.telegramChatId = '123456';
  config.notificationRoutes = {};
  config.applicantEmail = 'tolu@example.com';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `jobpilot-cmd-test-${crypto.randomUUID()}-`));
  config.profileDir = tempDir;
  config.jobStorePath = path.join(tempDir, 'processedJobs.json');
  config.siteRunStatePath = path.join(tempDir, 'siteRunState.json');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('api.telegram.org')) {
      const body = JSON.parse(options.body || '{}');
      if (urlStr.includes('sendMessage')) {
        sentMessages.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 101 } }),
          text: async () => JSON.stringify({ ok: true })
        };
      }
      if (urlStr.includes('answerCallbackQuery')) {
        answeredCallbacks.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
          text: async () => JSON.stringify({ ok: true })
        };
      }
      if (urlStr.includes('editMessageReplyMarkup')) {
        editedMessages.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
          text: async () => JSON.stringify({ ok: true })
        };
      }
    }
    return originalFetch(url, options);
  };

  return {
    config,
    sentMessages,
    answeredCallbacks,
    editedMessages,
    restore: () => {
      globalThis.fetch = originalFetch;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

test('Command: /help displays command categories and interactive navigation buttons', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    await handleTextCommand({ text: '/help', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.equal(ctx.sentMessages.length, 1);
    const msg = ctx.sentMessages[0].text;
    assert.ok(msg.includes('JobPilot Bot') && msg.includes('Commands'));
    assert.ok(msg.includes('/reviews'));
    assert.ok(msg.includes('/approve_all'));
    assert.ok(msg.includes('/skip_all'));
    assert.ok(msg.includes('/status'));

    const buttons = ctx.sentMessages[0].reply_markup?.inline_keyboard;
    assert.ok(buttons && buttons.length >= 2);
    assert.equal(buttons[0][0].text, '📋 Reviews');
    assert.equal(buttons[0][1].text, '📊 Status');
    assert.equal(buttons[1][0].text, '🚀 Run Now');
    assert.equal(buttons[1][1].text, '⚡ Apply Pending');
  } finally {
    ctx.restore();
  }
});

test('Command: /status shows detailed counts and quick-action buttons when pending jobs exist', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    const jobs = [
      { job_hash: '1', title: 'Job 1', status: 'applied', score: 85 },
      { job_hash: '2', title: 'Job 2', status: 'reviewed', score: 75 },
      { job_hash: '3', title: 'Job 3', status: 'pending_apply', score: 82 }
    ];
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs }), 'utf8');

    await handleTextCommand({ text: '/status', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.equal(ctx.sentMessages.length, 1);
    const msg = ctx.sentMessages[0].text;
    assert.ok(msg.includes('Status Overview'));
    assert.ok(msg.includes('Total processed: <b>3</b>'));
    assert.ok(msg.includes('Applied: <b>1</b>'));
    assert.ok(msg.includes('Pending review: <b>1</b>'));
    assert.ok(msg.includes('Queued to apply: <b>1</b>'));

    const buttons = ctx.sentMessages[0].reply_markup?.inline_keyboard;
    assert.ok(buttons && buttons.length >= 2);
    assert.ok(buttons[0][0].text.includes('Reviews (1)'));
    assert.ok(buttons[0][1].text.includes('Apply Pending (1)'));
  } finally {
    ctx.restore();
  }
});

test('Command: /sites renders formatted scraper statuses with clean icons', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    const state = {
      sites: {
        bruntwork: { lastStatus: 'ok', lastJobCount: 25 },
        jobberman: { lastStatus: 'ok', lastJobCount: 15 }
      }
    };
    fs.writeFileSync(ctx.config.siteRunStatePath, JSON.stringify(state), 'utf8');

    await handleTextCommand({ text: '/sites', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.equal(ctx.sentMessages.length, 1);
    const msg = ctx.sentMessages[0].text;
    assert.ok(msg.includes('Enabled Scrapers'));
    assert.ok(msg.includes('bruntwork'));
    assert.ok(msg.includes('ok (25 jobs)'));

    const buttons = ctx.sentMessages[0].reply_markup?.inline_keyboard;
    assert.ok(buttons && buttons.length >= 1);
    assert.equal(buttons[0][0].text, '🚀 Run Scraper');
  } finally {
    ctx.restore();
  }
});

test('Command: /skip_all dismisses all pending reviewed jobs in one operation', async () => {
  const ctx = createMockTelegramContext('sister');
  try {
    const jobs = [
      { job_hash: 'rev1', title: 'Job 1', status: 'reviewed', score: 75 },
      { job_hash: 'rev2', title: 'Job 2', status: 'reviewed', score: 72 }
    ];
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs }), 'utf8');

    await handleTextCommand({ text: '/skip_all', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.equal(ctx.sentMessages.length, 1);
    assert.ok(ctx.sentMessages[0].text.includes('2 jobs skipped'));

    const updated = JSON.parse(fs.readFileSync(ctx.config.jobStorePath, 'utf8'));
    assert.equal(updated.jobs[0].status, 'skipped');
    assert.equal(updated.jobs[1].status, 'skipped');
  } finally {
    ctx.restore();
  }
});

test('Command: /apply_pending gracefully informs user when queue is empty', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs: [] }), 'utf8');

    await handleTextCommand({ text: '/apply_pending', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.equal(ctx.sentMessages.length, 1);
    assert.ok(ctx.sentMessages[0].text.includes('No queued applications'));
  } finally {
    ctx.restore();
  }
});

test('apply queue summary distinguishes drained queue from successful submissions', () => {
  const text = formatApplyQueueSummary({
    applied: 1,
    manualReview: 1,
    failed: 1,
    outcomes: [
      { status: 'applied', title: 'Good role' },
      { status: 'manual_review', title: 'Complex form', reason: '41 required fields' },
      { status: 'failed', title: 'Closed role', reason: 'No longer accepting applications' }
    ]
  }, 0, 'Tolu');

  assert.match(text, /queue drained/);
  assert.match(text, /Submitted successfully: <b>1<\/b>/);
  assert.match(text, /Moved to manual review: <b>1<\/b>/);
  assert.match(text, /Failed: <b>1<\/b>/);
  assert.match(text, /MANUAL REVIEW.*Complex form/);
  assert.match(text, /queue is empty because eligible roles were processed/);

  const partial = formatApplyQueueSummary({ applied: 0, outcomes: [] }, 2, 'Tolu');
  assert.match(partial, /partially processed/);
  assert.match(partial, /Still queued: <b>2<\/b>/);
  assert.match(partial, /Roles still queued/);
});

test('Interactive Nav Callbacks: nav_status and nav_sites answer and respond correctly', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    await handleCallback({
      id: 'cb_123',
      data: 'nav_status:tolu:0',
      message: { message_id: 200, chat: { id: 123456 } }
    }, ctx.config, [ctx.config]);

    assert.equal(ctx.answeredCallbacks.length, 1);
    assert.equal(ctx.answeredCallbacks[0].text, 'Fetching status...');
    assert.ok(ctx.sentMessages.some((m) => m.text.includes('Status Overview')));
  } finally {
    ctx.restore();
  }
});

test('stale Telegram approval buttons do not duplicate an already queued application', async () => {
  const ctx = createMockTelegramContext('tolu');
  try {
    const job = {
      job_hash: 'abcdef1234567890abcdef1234567890',
      title: 'Already queued role',
      status: 'pending_apply',
      applicationUrl: 'https://example.test/apply',
      score: 90
    };
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs: [job] }), 'utf8');
    await handleCallback({
      id: 'cb_duplicate',
      data: 'accept:tolu:abcdef1234567890',
      message: {
        message_id: 201,
        chat: { id: 123456 },
        reply_markup: { inline_keyboard: [[{ text: 'Apply', callback_data: 'accept:tolu:abcdef1234567890' }]] }
      }
    }, ctx.config, [ctx.config]);

    assert.match(ctx.answeredCallbacks[0].text, /Already queued/);
    const updated = JSON.parse(fs.readFileSync(ctx.config.jobStorePath, 'utf8'));
    assert.equal(updated.jobs[0].status, 'pending_apply');
  } finally {
    ctx.restore();
  }
});

test('pending review view includes terminal manual-review jobs', async () => {
  const ctx = createMockTelegramContext('sister');
  try {
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs: [
      { job_hash: 'manual1234567890', title: 'Complex form role', status: 'manual_review', score: 84, reason: 'Complex form' }
    ] }), 'utf8');
    await handleTextCommand({ text: '/reviews', chat: { id: 123456 } }, ctx.config, [ctx.config]);
    assert.match(ctx.sentMessages[0].text, /Complex form role/);
    assert.match(ctx.sentMessages[0].text, /Manual review/);
  } finally {
    ctx.restore();
  }
});

test('recoverJobFromTelegramMessage parses failed/review message and recovers job to store', async () => {
  const ctx = createMockTelegramContext('sister');
  try {
    ctx.config.testMode = true;
    ctx.config.noRealSubmission = true;
    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs: [] }), 'utf8');

    const fakeMessage = {
      message_id: 999,
      chat: { id: 123456 },
      text: [
        '🔴 <b>JOBPILOT • FAILED</b>',
        '👤 Sister',
        '📌 CPT-11407 Property Management & Business Operations Virtual Assistant',
        '🏢 20four7VA · breezyhr',
        '📊 88/100 • Real Estate VA & Appointment Setting',
        '',
        '❌ Application not submitted',
        '⚠️ Application form required additional unmapped fields.',
        '🔗 https://20four7va.breezy.hr/p/54ecd7c5f751-cpt-11407-property-management-business-operations-virtual-assistant/apply'
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Retry Application', callback_data: 'retry:sister:54ecd7c5f751' },
            { text: 'Open Job 🌐', url: 'https://20four7va.breezy.hr/p/54ecd7c5f751-cpt-11407-property-management-business-operations-virtual-assistant/apply' }
          ]
        ]
      }
    };

    // Store has 0 jobs
    const storeBefore = JSON.parse(fs.readFileSync(ctx.config.jobStorePath, 'utf8'));
    assert.equal(storeBefore.jobs.length, 0);

    // Trigger retry callback
    await handleCallback({
      id: 'cb_retry_1',
      data: 'retry:sister:54ecd7c5f751',
      message: fakeMessage
    }, ctx.config, [ctx.config]);

    // Callback should NOT be 'Job not found'
    const callbackAnswer = ctx.answeredCallbacks.find((c) => c.text?.includes('Retrying application'));
    assert.ok(callbackAnswer, 'Expected callback answer to confirm retrying application');

    // Job should now exist in store
    const storeAfter = JSON.parse(fs.readFileSync(ctx.config.jobStorePath, 'utf8'));
    assert.equal(storeAfter.jobs.length, 1);
    assert.equal(storeAfter.jobs[0].title, 'CPT-11407 Property Management & Business Operations Virtual Assistant');
    assert.equal(storeAfter.jobs[0].company, '20four7VA');
    assert.equal(storeAfter.jobs[0].source_site, 'breezyhr');
    assert.equal(storeAfter.jobs[0].applicationUrl, 'https://20four7va.breezy.hr/p/54ecd7c5f751-cpt-11407-property-management-business-operations-virtual-assistant/apply');
  } finally {
    ctx.restore();
  }
});

test('Multi-job review digest allows clicking multiple jobs and preserves remaining buttons', async () => {
  const ctx = createMockTelegramContext('sister');
  try {
    const job1 = { job_hash: 'hash001122334455', title: 'VA 1', company: 'Co 1', status: 'reviewed', score: 85 };
    const job2 = { job_hash: 'hash002233445566', title: 'VA 2', company: 'Co 2', status: 'reviewed', score: 86 };
    const job3 = { job_hash: 'hash003344556677', title: 'VA 3', company: 'Co 3', status: 'reviewed', score: 87 };

    fs.writeFileSync(ctx.config.jobStorePath, JSON.stringify({ jobs: [job1, job2, job3] }), 'utf8');

    const digestMessage = {
      message_id: 888,
      chat: { id: 123456 },
      text: 'New review jobs [Sister] (3 found)\n1. VA 1\n2. VA 2\n3. VA 3',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ #1', callback_data: 'accept:sister:hash001122334455' },
            { text: '❌ #1', callback_data: 'reject:sister:hash001122334455' },
            { text: '🔗 #1', url: 'https://example.com/1' }
          ],
          [
            { text: '✅ #2', callback_data: 'accept:sister:hash002233445566' },
            { text: '❌ #2', callback_data: 'reject:sister:hash002233445566' },
            { text: '🔗 #2', url: 'https://example.com/2' }
          ],
          [
            { text: '✅ #3', callback_data: 'accept:sister:hash003344556677' },
            { text: '❌ #3', callback_data: 'reject:sister:hash003344556677' },
            { text: '🔗 #3', url: 'https://example.com/3' }
          ],
          [
            { text: 'Approve High Tier (>=85)', callback_data: 'approve_all:sister:85' }
          ]
        ]
      }
    };

    // Click #1
    await handleCallback({
      id: 'cb_1',
      data: 'accept:sister:hash001122334455',
      message: digestMessage
    }, ctx.config, [ctx.config]);

    // Wait for debounced editMessageReplyMarkup
    await new Promise((r) => setTimeout(r, 180));

    // Check edited message
    assert.equal(ctx.editedMessages.length, 1);
    const keyboardAfter1 = ctx.editedMessages[0].reply_markup.inline_keyboard;
    assert.equal(keyboardAfter1.length, 4); // All 4 rows preserved!
    assert.equal(keyboardAfter1[0][0].text, '✅ #1 Queued');
    assert.equal(keyboardAfter1[1][0].text, '✅ #2'); // #2 still clickable!
    assert.equal(keyboardAfter1[2][0].text, '✅ #3'); // #3 still clickable!

    // Click #2 on the updated keyboard
    digestMessage.reply_markup.inline_keyboard = keyboardAfter1;
    await handleCallback({
      id: 'cb_2',
      data: 'accept:sister:hash002233445566',
      message: digestMessage
    }, ctx.config, [ctx.config]);

    await new Promise((r) => setTimeout(r, 180));

    assert.equal(ctx.editedMessages.length, 2);
    const keyboardAfter2 = ctx.editedMessages[1].reply_markup.inline_keyboard;
    assert.equal(keyboardAfter2.length, 4); // All 4 rows preserved!
    assert.equal(keyboardAfter2[0][0].text, '✅ #1 Queued');
    assert.equal(keyboardAfter2[1][0].text, '✅ #2 Queued');
    assert.equal(keyboardAfter2[2][0].text, '✅ #3'); // #3 still clickable!
  } finally {
    ctx.restore();
  }
});
