import { appendLog } from './logger.js';
import { getJobRecord, upsertJobRecord, hashJob, loadJobStore } from './jobStore.js';
import { stripHtml } from './utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertTelegramChatAllowed, resolveTelegramRecipient } from './notifications/router.js';

const POLL_INTERVAL_MS = 3000;
let lastUpdateId = 0;
let pollingActive = false;

// Track how many review notifications sent per run to limit noise
let reviewNotifCount = 0;
let overflowCount = 0;
const MAX_REVIEW_NOTIFS_PER_RUN = 15;
const MIN_REVIEW_SCORE = 1;

function getStateFile(config) {
  return path.join(config?.profileDir || path.join(process.cwd(), 'data'), 'telegramState.json');
}

async function loadTelegramState(config) {
  try {
    const raw = await fs.readFile(getStateFile(config), 'utf-8');
    const state = JSON.parse(raw);
    if (typeof state.lastUpdateId === 'number') lastUpdateId = state.lastUpdateId;
  } catch { /* first run */ }
}

async function saveTelegramState(config) {
  try {
    const file = getStateFile(config);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ lastUpdateId }, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

export function resetReviewNotifCount() {
  reviewNotifCount = 0;
  overflowCount = 0;
}

// ---------------------------------------------------------------------------
// Telegram MarkdownV2 escaper — escapes ALL special chars required by the spec
// ---------------------------------------------------------------------------
function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function escapeMarkdownLinkUrl(url) {
  return String(url || '').replace(/[)\\]/g, '\\$&');
}

function profileLabel(config) {
  return config?.displayName || config?.profileName || '';
}

function profileCallbackKey(config) {
  return String(config?.profileName || config?.displayName || 'profile').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'profile';
}

async function sendWithRateLimit(config, chatId, payload) {
  await sleep(350); // proactive spacing — Telegram allows ~30 msg/s but burst triggers 429
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, ...payload })
      });
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const waitMs = ((data.parameters?.retry_after || 10) + 1) * 1000;
        await sleep(waitMs);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        await appendLog(`Telegram sendMessage failed (${response.status}): ${errText}`, config);
      }
      return response;
    } catch (error) {
      await appendLog(`Telegram sendMessage error: ${error.message}`, config);
    }
  }
}

/**
 * Send a reviewed job notification with job description snippet and interactive buttons.
 * Also stores applicationUrl + cover letter in the review record so Accept works.
 */
export async function sendReviewNotification(job, score, config) {
  const recipient = resolveTelegramRecipient(config, { job });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;
  if (score < MIN_REVIEW_SCORE) return;
  if (reviewNotifCount >= MAX_REVIEW_NOTIFS_PER_RUN) {
    overflowCount++;
    return;
  }
  reviewNotifCount++;

  const profilePrefix = profileLabel(config);
  const callbackProfile = profileCallbackKey(config);
  const jobHash = job.job_hash || job.hash || hashJob(job) || '';
  const company = job.company ? ` @ ${job.company}` : '';
  const url = job.applicationUrl || job.job_url || '';
  const desc = truncateDescription(job.description || job.raw?.description || '');

  const text = [
    `📋 *Review Required* \\[${escapeMarkdown(profilePrefix)}\\]`,
    '',
    `*${escapeMarkdown(job.title)}*${escapeMarkdown(company)}`,
    `⭐ Score: ${score} \\| 🌐 ${escapeMarkdown(job.source_site || 'unknown')}`,
    url ? `🔗 [View Job](${escapeMarkdownLinkUrl(url)})` : '',
    '',
    desc ? `📝 _${escapeMarkdown(desc)}_` : ''
  ].filter(Boolean).join('\n');

  // Telegram callback_data limit is 64 bytes — truncate hash to fit
  const shortHash = jobHash.slice(0, 16);
  await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Apply', callback_data: `accept:${callbackProfile}:${shortHash}` },
          { text: '❌ Skip', callback_data: `reject:${callbackProfile}:${shortHash}` }
        ],
        [
          { text: '📄 Full Description', callback_data: `details:${callbackProfile}:${shortHash}` }
        ]
      ]
    }
  });
}

export async function sendOverflowSummary(config) {
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id || overflowCount === 0) return;
  const n = overflowCount;
  overflowCount = 0;
  const text = `📭 *${n} more job${n === 1 ? '' : 's'} found* but not shown \\(cap reached\\)\\.\nUse /reviews to see all pending jobs\\.`;
  await sendWithRateLimit(config, recipient.telegram_chat_id, { text, parse_mode: 'MarkdownV2' });
}

function cleanDescription(raw) {
  const stripped = stripHtml(raw);
  const lines = stripped
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // Drop leading boilerplate lines before actual content
  const firstContentIdx = lines.findIndex((l) =>
    /job overview|about the role|about this role|responsibilities|requirements|qualifications|overview|position summary|role summary|the opportunity/i.test(l)
  );
  const contentLines = firstContentIdx > 0 ? lines.slice(firstContentIdx) : lines;
  return contentLines.join('\n').trim();
}

function formatDescriptionForTelegram(desc, maxChars = 3200) {
  const lines = cleanDescription(desc).split('\n').filter(Boolean);
  const parts = [];
  for (const line of lines) {
    if (line.length < 60 && /^[A-Z][A-Za-z\s&/]+:?$/.test(line)) {
      parts.push(`\n*${escapeMarkdown(line.replace(/:$/, ''))}*`);
    } else {
      parts.push(`• ${escapeMarkdown(line)}`);
    }
  }
  const result = parts.join('\n').trim();
  return result.length > maxChars ? result.slice(0, maxChars) + '\n_…\\(truncated\\)_' : result;
}

function truncateDescription(desc) {
  const lines = cleanDescription(desc).split('\n').filter(Boolean);
  const snippet = lines.slice(0, 3).join(' ');
  return snippet.length > 220 ? snippet.slice(0, 220) + '...' : snippet;
}

/**
 * Start polling for Telegram callback queries (button presses).
 * Call this once when the scheduler starts.
 */
export async function startTelegramPolling(configs) {
  if (pollingActive) return;
  pollingActive = true;

  const config = Array.isArray(configs) ? configs[0] : configs;
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) {
    console.log('[TelegramBot] No bot token/chat ID configured, skipping polling.');
    return;
  }

  await loadTelegramState(config);
  console.log(`[TelegramBot] Started polling for review callbacks (lastUpdateId=${lastUpdateId}).`);
  pollLoop(config, configs);
}

async function pollLoop(config, allConfigs) {
  while (pollingActive) {
    try {
      const updates = await getUpdates(config);
      for (const update of updates) {
        if (update.callback_query) {
          await handleCallback(update.callback_query, config, allConfigs);
        } else if (update.message?.text) {
          await handleTextCommand(update.message, config, allConfigs);
        }
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
      }
      if (updates.length > 0) await saveTelegramState(config);
    } catch (error) {
      console.error(`[TelegramBot] Poll error: ${error.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function getUpdates(config) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`;
  const params = new URLSearchParams({
    offset: String(lastUpdateId + 1),
    timeout: '10',
    allowed_updates: JSON.stringify(['callback_query', 'message'])
  });

  const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return [];

  const data = await response.json();
  return data.ok ? data.result : [];
}

async function handleCallback(callbackQuery, config, allConfigs) {
  const data = callbackQuery.data || '';
  if (data === 'noop') { await answerCallback(config, callbackQuery.id, ''); return; }

  const [action, profileName, jobHash] = data.split(':');
  const messageId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;

  if (!action || !profileName || !jobHash) {
    await answerCallback(config, callbackQuery.id, '⚠️ Invalid data');
    return;
  }

  const profileConfig = findProfileConfig(profileName, allConfigs) || config;
  if (!assertTelegramChatAllowed(profileConfig, chatId, { profile_id: profileConfig.profileName })) {
    await answerCallback(config, callbackQuery.id, 'This Telegram chat is not linked to that profile.');
    await appendLog(`Rejected Telegram callback for ${profileName}: chat ${chatId} is not linked`, profileConfig);
    return;
  }

  if (action === 'accept') {
    const record = await findJobByHash(profileConfig, jobHash);
    if (record) {
      // Store all fields needed for application — including applicationUrl from job_url
      await upsertJobRecord(profileConfig, record, 'pending_apply', {
        decision: 'apply',
        acceptedViaTelegram: true,
        acceptedAt: new Date().toISOString(),
        // Ensure applicationUrl is preserved for the flush queue
        applicationUrl: record.applicationUrl || record.job_url || ''
      });
      await answerCallback(config, callbackQuery.id, '✅ Queued for application!');
      await editMessageButtons(config, chatId, messageId, '✅ ACCEPTED — will apply next run');
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found in store');
    }
  } else if (action === 'reject') {
    const record = await findJobByHash(profileConfig, jobHash);
    if (record) {
      await upsertJobRecord(profileConfig, record, 'skipped', {
        decision: 'skip',
        rejectedViaTelegram: true,
        rejectedAt: new Date().toISOString()
      });
      await answerCallback(config, callbackQuery.id, '❌ Skipped');
      await editMessageButtons(config, chatId, messageId, '❌ SKIPPED');
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found');
    }
  } else if (action === 'details') {
    const record = await findJobByHash(profileConfig, jobHash);
    if (record) {
      await answerCallback(config, callbackQuery.id, '📄 Sending details...');
      await sendJobDetails(config, chatId, record, profileName);
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found');
    }
  }
}

async function handleTextCommandLegacy(message, config, allConfigs) {
  const text = (message.text || '').trim().toLowerCase();
  const chatId = message.chat?.id;
  if (!assertTelegramChatAllowed(config, chatId, { profile_id: config.profileName })) {
    await appendLog(`Rejected Telegram command from unlinked chat ${chatId}`, config);
    return;
  }

  if (text === '/reviews' || text === '/pending') {
    await sendPendingReviews(config, chatId);
  } else if (text === '/help' || text === '/start') {
    await sendHelpMessage(config, chatId);
  } else if (text === '/status' || text === '/stats') {
    await sendStatusMessage(config, chatId);
  } else if (text === '/approve_all') {
    await approveAllJobs(config, chatId, 80);
  } else if (text === '/approve_top') {
    await approveTopJob(config, chatId);
  } else if (text.startsWith('/approve_score')) {
    // /approve_score 75  — approves all jobs above given score
    const threshold = parseInt(text.split(/\s+/)[1], 10) || 80;
    await approveAllJobs(config, chatId, threshold);
  }
}

async function handleTextCommand(message, config, allConfigs) {
  const rawText = (message.text || '').trim();
  const text = rawText.toLowerCase();
  const chatId = message.chat?.id;
  const target = resolveCommandTarget(rawText, config, allConfigs);
  const targetConfig = target.config;

  if (!assertTelegramChatAllowed(targetConfig, chatId, { profile_id: targetConfig.profileName })) {
    await appendLog(`Rejected Telegram command from unlinked chat ${chatId}`, targetConfig);
    return;
  }

  if (target.allProfiles && (text.startsWith('/status') || text.startsWith('/stats'))) {
    for (const profileConfig of normalizeConfigList(allConfigs, config)) {
      if (assertTelegramChatAllowed(profileConfig, chatId, { profile_id: profileConfig.profileName })) {
        await sendStatusMessage(profileConfig, chatId);
      }
    }
    return;
  }

  if (target.command === '/reviews' || target.command === '/pending' || target.command === '/queue') {
    await sendPendingReviews(targetConfig, chatId);
  } else if (target.command === '/help' || target.command === '/start') {
    await sendHelpMessage(targetConfig, chatId, allConfigs);
  } else if (target.command === '/status' || target.command === '/stats') {
    await sendStatusMessage(targetConfig, chatId);
  } else if (target.command === '/sites') {
    await sendSitesMessage(targetConfig, chatId);
  } else if (target.command === '/approve_all') {
    await approveAllJobs(targetConfig, chatId, 80);
  } else if (target.command === '/approve_top') {
    await approveTopJob(targetConfig, chatId);
  } else if (target.command === '/approve_score') {
    const threshold = parseInt(target.args.find((part) => /^\d+$/.test(part)), 10) || 80;
    await approveAllJobs(targetConfig, chatId, threshold);
  }
}

function resolveCommandTarget(rawText, fallbackConfig, allConfigs) {
  const parts = String(rawText || '').trim().split(/\s+/).filter(Boolean);
  const command = normalizeCommand(parts[0] || '');
  const args = parts.slice(1);
  const configs = normalizeConfigList(allConfigs, fallbackConfig);
  const profileArg = args.find((part) => part.toLowerCase() === 'all' || findProfileConfig(part, configs));
  const allProfiles = profileArg?.toLowerCase() === 'all';
  const targetConfig = allProfiles ? fallbackConfig : findProfileConfig(profileArg, configs) || fallbackConfig;
  return { command, args, config: targetConfig, allProfiles };
}

function normalizeCommand(command) {
  return String(command || '').split('@')[0].toLowerCase();
}

function normalizeConfigList(allConfigs, fallbackConfig) {
  return Array.isArray(allConfigs) ? allConfigs : [fallbackConfig].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Bulk approval commands
// ---------------------------------------------------------------------------

async function approveAllJobs(config, chatId, minScore = 80) {
  let store;
  try {
    store = await loadJobStore(config);
  } catch {
    await sendTelegramMessage(config, chatId, '⚠️ Could not read job store\\.');
    return;
  }

  const eligible = (store.jobs || [])
    .filter((j) => j.status === 'reviewed' && (j.score || 0) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (eligible.length === 0) {
    await sendTelegramMessage(config, chatId, `✨ No reviewed jobs with score ≥ ${minScore} found\\.`);
    return;
  }

  for (const record of eligible) {
    await upsertJobRecord(config, record, 'pending_apply', {
      decision: 'apply',
      acceptedViaTelegram: true,
      acceptedAt: new Date().toISOString(),
      applicationUrl: record.applicationUrl || record.job_url || ''
    });
  }

  const profileName = profileLabel(config);
  const text = `✅ *${eligible.length} job${eligible.length === 1 ? '' : 's'} approved* \\[${escapeMarkdown(profileName)}\\]\n_Score ≥ ${minScore} \\| Will apply on next run_`;
  await sendTelegramMessage(config, chatId, text);
}

async function approveTopJob(config, chatId) {
  let store;
  try {
    store = await loadJobStore(config);
  } catch {
    await sendTelegramMessage(config, chatId, '⚠️ Could not read job store\\.');
    return;
  }

  const reviewed = (store.jobs || [])
    .filter((j) => j.status === 'reviewed')
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (reviewed.length === 0) {
    await sendTelegramMessage(config, chatId, '✨ No pending jobs to approve\\.');
    return;
  }

  const top = reviewed[0];
  await upsertJobRecord(config, top, 'pending_apply', {
    decision: 'apply',
    acceptedViaTelegram: true,
    acceptedAt: new Date().toISOString(),
    applicationUrl: top.applicationUrl || top.job_url || ''
  });

  const text = `✅ *Top job approved\\!*\n*${escapeMarkdown(top.title || 'Unknown')}* — Score: ${top.score || 0}\n_Will apply on next run_`;
  await sendTelegramMessage(config, chatId, text);
}

// ---------------------------------------------------------------------------
// Formatted message senders
// ---------------------------------------------------------------------------

async function sendJobDetails(config, chatId, record, profileName) {
  const rawDesc = record.description || record.raw?.description || 'No description available.';
  const formattedDesc = formatDescriptionForTelegram(rawDesc);
  const shortHash = (record.job_hash || '').slice(0, 16);
  const url = record.job_url || record.applicationUrl || '';
  const callbackProfile = profileCallbackKey(config);

  const text = [
    `📄 *Job Details*`,
    `*${escapeMarkdown(record.title || 'Unknown')}*`,
    record.company ? `🏢 ${escapeMarkdown(record.company)}` : '',
    `⭐ Score: ${record.score || 0}`,
    url ? `🔗 [Open Link](${escapeMarkdownLinkUrl(url)})` : '',
    '',
    formattedDesc
  ].filter(Boolean).join('\n');

  await sendWithRateLimit(config, chatId, {
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Apply', callback_data: `accept:${callbackProfile}:${shortHash}` },
        { text: '❌ Skip', callback_data: `reject:${callbackProfile}:${shortHash}` }
      ]]
    }
  });
}

async function sendPendingReviews(config, chatId) {
  let reviews = [];
  try {
    const store = await loadJobStore(config);
    reviews = (store.jobs || [])
      .filter((j) => j.status === 'reviewed' || j.status === 'pending_apply')
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
  } catch { /* empty */ }

  if (reviews.length === 0) {
    await sendTelegramMessage(config, chatId, '✨ No pending reviews\\! All caught up\\.');
    return;
  }

  const profileName = profileLabel(config);
  const callbackProfile = profileCallbackKey(config);
  let msg = `📋 *Pending Reviews* \\[${escapeMarkdown(profileName)}\\] \\(${reviews.length}\\):\n\n`;

  for (const job of reviews) {
    const status = job.status === 'pending_apply' ? '🟢' : '🟡';
    msg += `${status} *${escapeMarkdown(job.title || 'Unknown')}* — Score: ${job.score || 0}\n`;
  }

  // Send with buttons for top 3
  const buttons = reviews.slice(0, 3).map((job) => [{
    text: `${job.title?.slice(0, 25) || 'Job'}... (${job.score})`,
    callback_data: `details:${callbackProfile}:${(job.job_hash || '').slice(0, 16)}`
  }]);

  await sendWithRateLimit(config, chatId, { text: msg, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: buttons } });
}

async function sendHelpMessageLegacy(config, chatId) {
  const text = [
    '🤖 *JobPilot Bot — Commands*',
    '',
    '/reviews — Show pending reviewed jobs',
    '/status — Show bot stats for this profile',
    '/approve\\_all — Approve all jobs with score ≥ 80',
    '/approve\\_top — Approve the highest\\-scored job',
    '/approve\\_score 75 — Approve all jobs ≥ a custom score',
    '/help — Show this message',
    '',
    '*Button Actions:*',
    '✅ Apply — Queue job for auto\\-application',
    '❌ Skip — Permanently skip this job',
    '📄 Full Description — See full job details'
  ].join('\n');

  await sendTelegramMessage(config, chatId, text);
}

async function sendHelpMessage(config, chatId, allConfigs = config) {
  const profiles = normalizeConfigList(allConfigs, config)
    .map((item) => item.profileName)
    .filter(Boolean)
    .join(', ');
  const text = [
    '*JobPilot Bot - Commands*',
    '',
    '/reviews - show pending reviewed jobs',
    '/queue - same as /reviews',
    '/status - show stats for this profile',
    '/status all - show stats for every linked profile',
    '/sites - show enabled sites and last scraper result',
    '/approve\\_all - approve reviewed jobs with score >= 80',
    '/approve\\_top - approve the highest-scored reviewed job',
    '/approve\\_score 75 - approve jobs >= a custom score',
    '/help - show this message',
    '',
    profiles ? `Profiles: ${escapeMarkdown(profiles)}` : '',
    'Tip: add a profile name, like `/reviews tolu` or `/approve\\_all sister`.'
  ].filter(Boolean).join('\n');

  await sendTelegramMessage(config, chatId, text);
}

async function sendStatusMessage(config, chatId) {
  let stats = { total: 0, applied: 0, reviewed: 0, pending_apply: 0, ignored: 0, failed: 0 };
  try {
    const store = await loadJobStore(config);
    const jobs = store.jobs || [];
    stats.total = jobs.length;
    stats.applied = jobs.filter((j) => j.status === 'applied').length;
    stats.reviewed = jobs.filter((j) => j.status === 'reviewed').length;
    stats.pending_apply = jobs.filter((j) => j.status === 'pending_apply').length;
    stats.ignored = jobs.filter((j) => j.status === 'ignored').length;
    stats.failed = jobs.filter((j) => j.status === 'failed').length;
  } catch { /* empty */ }

  const profileName = profileLabel(config);
  const text = [
    `📊 *Status* \\[${escapeMarkdown(profileName)}\\]`,
    '',
    `Total processed: ${stats.total}`,
    `✅ Applied: ${stats.applied}`,
    `🟡 Pending review: ${stats.reviewed}`,
    `🟢 Queued to apply: ${stats.pending_apply}`,
    `⏭️ Ignored: ${stats.ignored}`,
    `❌ Failed: ${stats.failed}`
  ].join('\n');

  await sendTelegramMessage(config, chatId, text);
}

async function sendSitesMessage(config, chatId) {
  let runState = { sites: {} };
  try {
    const raw = await fs.readFile(config.siteRunStatePath, 'utf8');
    runState = JSON.parse(raw);
  } catch { /* empty */ }

  const enabledSites = Object.entries(config.sites || {})
    .filter(([, siteConfig]) => siteConfig.enabled)
    .sort(([, left], [, right]) => {
      const leftPriority = Number.parseInt(left.priority, 10);
      const rightPriority = Number.parseInt(right.priority, 10);
      return (Number.isFinite(leftPriority) ? leftPriority : 999) - (Number.isFinite(rightPriority) ? rightPriority : 999);
    })
    .slice(0, 30);

  const lines = enabledSites.map(([site, siteConfig]) => {
    const state = runState.sites?.[site] || {};
    const status = state.lastStatus || 'new';
    const count = Number.isFinite(state.lastJobCount) ? state.lastJobCount : 0;
    const mode = siteConfig.autoApplyEnabled ? 'auto' : 'review';
    return `- ${escapeMarkdown(site)}: ${escapeMarkdown(status)} / ${count} / ${mode}`;
  });

  const text = [
    `*Enabled Sites* \\[${escapeMarkdown(profileLabel(config))}\\]`,
    '',
    ...lines
  ].join('\n');

  await sendTelegramMessage(config, chatId, text);
}

/**
 * Send the daily 8AM summary (called by scheduler).
 */
export async function sendDailySummary(config) {
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  let stats = { applied: 0, reviewed: 0, failed: 0, total: 0 };
  try {
    const store = await loadJobStore(config);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = (store.jobs || []).filter((j) => j.updatedAt && new Date(j.updatedAt).getTime() >= cutoff);
    stats.total = recent.length;
    stats.applied = recent.filter((j) => j.status === 'applied').length;
    stats.reviewed = recent.filter((j) => j.status === 'reviewed').length;
    stats.failed = recent.filter((j) => j.status === 'failed').length;
  } catch { /* skip */ }

  const profileName = profileLabel(config);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const text = [
    `☀️ *Daily Summary* \\[${escapeMarkdown(profileName)}\\] — ${escapeMarkdown(today)}`,
    '',
    `📊 Last 24h: ${stats.total} jobs processed`,
    `✅ Applied: ${stats.applied}`,
    `🟡 Pending review: ${stats.reviewed}`,
    `❌ Failed: ${stats.failed}`,
    '',
    stats.reviewed > 0 ? `_Use /approve\\_all to bulk\\-approve pending jobs_` : '_All clear\\! No jobs awaiting review_'
  ].join('\n');

  await sendWithRateLimit(config, recipient.telegram_chat_id, { text, parse_mode: 'MarkdownV2' });
}

async function sendTelegramMessage(config, chatId, text) {
  await sendWithRateLimit(config, chatId, { text, parse_mode: 'MarkdownV2', disable_web_page_preview: true });
}

async function answerCallback(config, callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  }).catch(() => {});
}

async function editMessageButtons(config, chatId, messageId, statusText) {
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: statusText, callback_data: 'noop' }]] }
    })
  }).catch(() => {});
}

async function findJobByHash(config, jobHash) {
  try {
    const store = await loadJobStore(config);
    return store.jobs?.find((j) => j.job_hash === jobHash || j.job_hash?.startsWith(jobHash)) || null;
  } catch {
    return null;
  }
}

function findProfileConfig(profileName, allConfigs) {
  if (!profileName) return null;
  if (!Array.isArray(allConfigs)) return null;
  const normalizedProfile = String(profileName).toLowerCase();
  return allConfigs.find((c) =>
    [c.displayName, c.profileName, profileCallbackKey(c)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === normalizedProfile)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stopTelegramPolling() {
  pollingActive = false;
}
