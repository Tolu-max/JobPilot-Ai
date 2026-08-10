import { appendLog } from './logger.js';
import { getJobRecord, upsertJobRecord, hashJob, loadJobStore, loadGlobalJobStore } from './jobStore.js';
import { stripHtml } from './utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertTelegramChatAllowed, resolveTelegramRecipient } from './notifications/router.js';
import { hasRunner, isPaused, requestRun, setPaused } from './botControl.js';
import { flushPendingApplyQueue } from './pipeline.js';

const POLL_INTERVAL_MS = 3000;
let lastUpdateId = 0;
let pollingActive = false;

// Track how many review notifications sent per run to limit noise
let reviewNotifCount = 0;
let overflowCount = 0;
const MAX_REVIEW_NOTIFS_PER_RUN = 50;
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
  const cleanPayload = sanitizeTelegramPayload(payload);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, ...cleanPayload })
      });
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const waitMs = ((data.parameters?.retry_after || 10) + 1) * 1000;
        await sleep(waitMs);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        // A malformed upstream title/description must not suppress the review.
        // Retry without Markdown so the notification still reaches Telegram.
        if (response.status === 400 && cleanPayload.parse_mode) {
          const fallbackPayload = { ...cleanPayload };
          delete fallbackPayload.parse_mode;
          const fallbackResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, ...fallbackPayload })
          });
          if (fallbackResponse.ok) {
            await appendLog('Telegram Markdown rejected; delivered message as plain text.', config);
            return fallbackResponse;
          }
        }
        await appendLog(`Telegram sendMessage failed (${response.status}): ${errText}`, config);
      }
      return response;
    } catch (error) {
      await appendLog(`Telegram sendMessage error: ${error.message}`, config);
    }
  }
}

function sanitizeTelegramPayload(payload = {}) {
  return sanitizeTelegramValue(payload);
}

function sanitizeTelegramValue(value) {
  if (typeof value === 'string') return cleanTelegramText(value);
  if (Array.isArray(value)) return value.map(sanitizeTelegramValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeTelegramValue(item)])
    );
  }
  return value;
}

const TELEGRAM_TEXT_REPLACEMENTS = [
  ['•', '-'], ['…', '...'], ['—', '-'], ['≥', '>='], ['ℹ️', 'Info:'],
  // Mojibake fallbacks for double-encoded upstream data (UTF-8 bytes interpreted as Latin-1)
  ['\u00f0\u0178\u201c\u2039', ''], ['\u00f0\u0178\u201c\u00ad', ''], ['\u00f0\u0178\u201c\u009d', ''], ['\u00f0\u0178\u201c\u201e', ''], ['\u00f0\u0178\u201c\u0161', ''], ['\u00f0\u0178\u0152\u00c2\u00b8', ''], ['\u00f0\u0178\u017d\u00a2', ''], ['\u00f0\u0178\u00a4\u00e2\u20ac\u201c', ''],
  ['\u00f0\u0178\u017f\u00a1', 'Review'], ['\u00f0\u0178\u017f\u00a2', 'Queued'], ['\u00e2\u02dc\u00b0\u00ef\u00b8\u2018', ''], ['\u00e2\u0153\u00a5', ''], ['\u00e2\u009d\u0152', ''], ['\u00e2\u0161\u00a0\u00ef\u00b8\u2018', 'Warning:'],
  ['\u00e2\u00ad\u0090', 'Score:'], ['\u00e2\u008f\u00ad\u00ef\u00b8\u2018', 'Ignored:'], ['\u00f0\u0178\u201c\u2014', ''], ['\u00e2\u0153\u00a8', ''],
  ['\u00e2\u20ac\u00a2', '-'], ['\u00e2\u20ac\u00a6', '...'], ['\u00e2\u20ac\u201d', '-'], ['\u00e2\u2030\u00a5', '>='], ['\u00e2\u201e\u00b9\u00ef\u00b8\u2018', 'Info:']
];

function cleanTelegramText(value) {
  let cleaned = String(value || '');
  for (const [pattern, replacement] of TELEGRAM_TEXT_REPLACEMENTS) {
    cleaned = cleaned.split(pattern).join(replacement);
  }
  return cleaned
    // Telegram accepts Unicode, but forcing ASCII prevents broken mojibake from
    // incorrectly decoded job-board content or legacy notification templates.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  return sendReviewNotificationHtml(job, score, config);

  const profilePrefix = profileLabel(config);
  const callbackProfile = profileCallbackKey(config);
  const jobHash = job.job_hash || job.hash || hashJob(job) || '';
  const company = job.company ? ` @ ${job.company}` : '';
  const url = job.applicationUrl || job.job_url || '';
  const reviewReason = job.reviewReason || job.review_reason || '';
  const desc = truncateDescription([
    reviewReason ? `Reason: ${reviewReason}` : '',
    job.description || job.raw?.description || ''
  ].filter(Boolean).join('\n\n'));

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

async function sendReviewNotificationHtml(job, score, config) {
  const recipient = resolveTelegramRecipient(config, { job });
  const profile = escapeHtml(profileLabel(config));
  const callbackProfile = profileCallbackKey(config);
  const jobHash = job.job_hash || job.hash || hashJob(job) || '';
  const shortHash = jobHash.slice(0, 16);
  const title = escapeHtml(job.title || 'Untitled role');
  const company = job.company ? `\nCompany: ${escapeHtml(job.company)}` : '';
  const url = job.applicationUrl || job.job_url || '';
  const reviewReason = job.reviewReason || job.review_reason || '';
  const desc = truncateDescription(reviewReason || job.description || job.raw?.description || '');
  const text = [
    `<b>Review required</b> [${profile}]`,
    '',
    `<b>${title}</b>${company}`,
    `Score: ${escapeHtml(score)} | Source: ${escapeHtml(job.source_site || 'unknown')}`,
    desc ? `Reason: ${escapeHtml(desc)}` : ''
  ].filter(Boolean).join('\n');
  const firstRow = [];
  if (url) firstRow.push({ text: 'Open job', url });
  firstRow.push({ text: 'Apply', callback_data: `accept:${callbackProfile}:${shortHash}` });
  firstRow.push({ text: 'Skip', callback_data: `reject:${callbackProfile}:${shortHash}` });
  await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        firstRow,
        [{ text: 'Details', callback_data: `details:${callbackProfile}:${shortHash}` }]
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
  const withoutPagePayloads = String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/self\.__next_f\.push\([\s\S]*$/i, ' ');
  const stripped = stripHtml(withoutPagePayloads);
  const lines = stripped
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^self\.__next|^static\/chunks|^\(self\.__next|^\[?object Object\]?$/i.test(line));
  // Drop leading boilerplate lines before actual content
  const firstContentIdx = lines.findIndex((l) =>
    /job overview|about the role|about this role|responsibilities|requirements|qualifications|overview|position summary|role summary|the opportunity/i.test(l)
  );
  const contentLines = firstContentIdx > 0 ? lines.slice(firstContentIdx) : lines;
  return contentLines.join('\n').trim() || 'Job description unavailable. Open the job link for the complete posting.';
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
          console.log(`[TelegramBot] Received callback ${update.callback_query.data || 'unknown'}`);
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

  try {
    const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      await appendLog(`Telegram getUpdates failed (${response.status}): ${errText}`, config);
      return [];
    }
    const data = await response.json();
    if (!data.ok) {
      await appendLog(`Telegram getUpdates API error: ${data.description || 'unknown'}`, config);
      return [];
    }
    return data.result || [];
  } catch (error) {
    const label = error.name === 'AbortError' ? 'timed out' : `error: ${error.message}`;
    await appendLog(`Telegram getUpdates ${label}`, config);
    return [];
  }
}

async function handleCallback(callbackQuery, config, allConfigs) {
  const data = callbackQuery.data || '';
  if (data === 'noop') { await answerCallback(config, callbackQuery.id, ''); return; }

  const [action, profileName, jobHash] = data.split(':');
  const messageId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;
  console.log(`[TelegramBot] Handling callback action=${action || 'unknown'} profile=${profileName || 'unknown'} hash=${jobHash || 'unknown'}`);

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
    const record = await findJobByHash(profileConfig, jobHash, allConfigs);
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
      await editMessageButtons(config, chatId, messageId, '✅ ACCEPTED - will apply next run');
      await appendLog('Telegram acceptance queued; waiting for the next scheduled run.', profileConfig);
      try {
        await flushPendingApplyQueue(profileConfig);
        const updated = await findJobByHash(profileConfig, jobHash, allConfigs);
        await sendTelegramApplicationResult(profileConfig, chatId, updated || record);
      } catch (error) {
        await sendTelegramMessage(profileConfig, chatId, `Application run failed: ${escapeMarkdown(error.message || 'unknown error')}\\.`);
        await appendLog(`Telegram-approved application flush failed: ${error.stack || error.message}`, profileConfig);
      }
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found in store');
    }
  } else if (action === 'reject') {
    const record = await findJobByHash(profileConfig, jobHash, allConfigs);
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
  } else if (action === 'retry') {
    const record = await findJobByHash(profileConfig, jobHash, allConfigs);
    if (record) {
      await upsertJobRecord(profileConfig, record, 'pending_apply', {
        decision: 'apply',
        acceptedViaTelegram: true,
        acceptedAt: new Date().toISOString(),
        retryCount: 0,
        terminal: false,
        applicationUrl: record.applicationUrl || record.job_url || ''
      });
      await answerCallback(config, callbackQuery.id, 'Retrying application');
      await editMessageButtons(config, chatId, messageId, 'Retrying application');
      try {
        await flushPendingApplyQueue(profileConfig);
        const updated = await findJobByHash(profileConfig, jobHash, allConfigs);
        await sendTelegramApplicationResult(profileConfig, chatId, updated || record);
      } catch (error) {
        await sendTelegramMessage(profileConfig, chatId, `Application retry failed: ${escapeMarkdown(error.message || 'unknown error')}\\.`);
      }
    } else {
      await answerCallback(config, callbackQuery.id, 'Job not found');
    }
  } else if (action === 'details') {
    const record = await findJobByHash(profileConfig, jobHash, allConfigs);
    if (record) {
      await answerCallback(config, callbackQuery.id, '📄 Sending details...');
      await sendJobDetails(config, chatId, record, profileName);
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found');
    }
  } else if (action === 'approve_all') {
    const threshold = parseInt(jobHash, 10) || 80;
    await answerCallback(config, callbackQuery.id, `✅ Approving reviewed jobs ≥ ${threshold}...`);
    await approveAllJobs(profileConfig, chatId, threshold);
    await editMessageButtons(config, chatId, messageId, '✅ All pending jobs approved');
  } else if (action === 'approve_top') {
    await answerCallback(config, callbackQuery.id, '✅ Approving top job...');
    await approveTopJob(profileConfig, chatId);
    await editMessageButtons(config, chatId, messageId, '✅ Top job approved');
  }
}

async function handleTextCommand(message, config, allConfigs) {
  const rawText = (message.text || '').trim();
  const text = rawText.toLowerCase();
  const chatId = message.chat?.id;
  const target = resolveCommandTarget(rawText, config, allConfigs);
  const targetConfig = target.config;
  console.log(`[TelegramBot] Received command ${rawText} for ${targetConfig?.profileName || 'default'} from chat ${chatId}`);

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
  } else if (target.command === '/pause') {
    setPaused(true);
    await sendTelegramMessage(targetConfig, chatId, `*Paused* \\[${escapeMarkdown(profileLabel(targetConfig))}\\]\nScheduled runs will wait until /resume\\. Use /run to force one run now\\.`);
  } else if (target.command === '/resume') {
    setPaused(false);
    await sendTelegramMessage(targetConfig, chatId, `*Resumed* \\[${escapeMarkdown(profileLabel(targetConfig))}\\]\nScheduled runs are active again\\.`);
  } else if (target.command === '/run' || target.command === '/run_now') {
    await runNowFromTelegram(targetConfig, chatId);
  } else if (target.command === '/apply_pending' || target.command === '/flush_pending') {
    await sendTelegramMessage(targetConfig, chatId, `Starting approved applications for *${escapeMarkdown(profileLabel(targetConfig))}*\\.\\.`);
    try {
      await flushPendingApplyQueue(targetConfig);
      const store = await loadJobStore(targetConfig);
      const pending = (store.jobs || []).filter((job) => job.status === 'pending_apply').length;
      await sendTelegramMessage(targetConfig, chatId, `Approved application queue finished\\. Pending now: ${pending}\\.`);
    } catch (error) {
      await sendTelegramMessage(targetConfig, chatId, `Approved application queue failed: ${escapeMarkdown(error.message || 'unknown error')}\\.`);
    }
  }
}

async function sendTelegramApplicationResult(config, chatId, record = {}) {
  const status = String(record.status || 'unknown');
  const title = escapeMarkdown(record.title || 'Job');
  const url = record.job_url || record.applicationUrl || record.url || record.job?.job_url || record.job?.applicationUrl || '';
  if (status === 'applied') {
    await sendTelegramMessage(config, chatId, `*Application confirmed*\n${title}`);
    return;
  }
  const reason = record.reason || record.skippedBecause || 'The application was not submitted.';
  const conciseReason = String(reason).replace(/[.!?]+\s*$/, '');
  const label = status === 'manual_review'
    ? 'Manual review required'
    : status === 'reviewed'
      ? 'Review retained'
      : `Application status: ${status}`;
  const buttons = [];
  if (url) buttons.push([{ text: 'Open job', url }]);
  if (status === 'manual_review') {
    const profile = profileCallbackKey(config);
    const hash = String(record.job_hash || '').slice(0, 16);
    if (hash) buttons.push([{ text: 'Retry application', callback_data: `retry:${profile}:${hash}` }]);
  }
  await sendWithRateLimit(config, chatId, {
    text: `*${escapeMarkdown(label)}*\n${title}\n${escapeMarkdown(conciseReason)}\\.`,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {})
  });
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
  return sendPendingReviewsHtml(config, chatId);

  let reviews = [];
  try {
    const store = await loadJobStore(config);
    reviews = (store.jobs || [])
      .filter((j) => j.status === 'reviewed' || j.status === 'pending_apply')
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
  } catch { /* empty */ }

  console.log(`[TelegramBot] Pending reviews for ${config?.profileName || 'default'}: ${reviews.length}`);

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

  // Put primary actions directly on the queue.
  const buttons = reviews.slice(0, 3).flatMap((job) => {
    const hash = (job.job_hash || '').slice(0, 16);
    const row = [
      { text: 'Apply', callback_data: `accept:${callbackProfile}:${hash}` },
      { text: 'Skip', callback_data: `reject:${callbackProfile}:${hash}` }
    ];
    if (job.job_url || job.applicationUrl) {
      row.unshift({ text: 'Open', url: job.job_url || job.applicationUrl });
    }
    return [row];
  });

  await sendWithRateLimit(config, chatId, { text: msg, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: buttons } });
}

async function sendPendingReviewsHtml(config, chatId) {
  let reviews = [];
  try {
    const store = await loadJobStore(config);
    reviews = (store.jobs || [])
      .filter((j) => j.status === 'reviewed' || j.status === 'pending_apply')
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
  } catch { /* empty */ }

  if (reviews.length === 0) {
    await sendWithRateLimit(config, chatId, { text: '<b>Pending reviews</b>\nNo pending reviews. All caught up.', parse_mode: 'HTML' });
    return;
  }

  const profile = escapeHtml(profileLabel(config));
  const callbackProfile = profileCallbackKey(config);
  const lines = reviews.map((job, index) => {
    const status = job.status === 'pending_apply' ? 'Queued' : 'Review';
    return `${index + 1}. <b>${escapeHtml(job.title || 'Untitled role')}</b>\nScore: ${escapeHtml(job.score || 0)} | Status: ${status}`;
  });
  const buttons = reviews.slice(0, 3).flatMap((job) => {
    const hash = (job.job_hash || hashJob(job) || '').slice(0, 16);
    const row = [];
    if (job.job_url || job.applicationUrl) row.push({ text: 'Open job', url: job.job_url || job.applicationUrl });
    row.push({ text: 'Apply', callback_data: `accept:${callbackProfile}:${hash}` });
    row.push({ text: 'Skip', callback_data: `reject:${callbackProfile}:${hash}` });
    return [row];
  });
  await sendWithRateLimit(config, chatId, {
    text: [`<b>Pending reviews</b> [${profile}] (${reviews.length})`, '', ...lines].join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons }
  });
}

export { sendPendingReviews };

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
    '/pause - pause scheduled runs',
    '/resume - resume scheduled runs',
    '/run - run the scheduler now',
    '/apply_pending - flush Telegram-approved applications now',
    '/approve\\_all - approve reviewed jobs with score >= 80',
    '/approve\\_top - approve the highest-scored reviewed job',
    '/approve\\_score 75 - approve jobs >= a custom score',
    '/help - show this message',
    '',
    profiles ? `Profiles: ${escapeMarkdown(profiles)}` : '',
    `Scheduler: ${isPaused() ? 'paused' : 'active'}${hasRunner() ? '' : ' \\(manual run unavailable\\)'}`,
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
  const callbackProfile = profileCallbackKey(config);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const text = [
    `☀️ *Daily Summary* \[${escapeMarkdown(profileName)}\] — ${escapeMarkdown(today)}`,
    '',
    `📊 Last 24h: ${stats.total} jobs processed`,
    `✅ Applied: ${stats.applied}`,
    `🟡 Pending review: ${stats.reviewed}`,
    `❌ Failed: ${stats.failed}`,
    '',
    stats.reviewed > 0 ? '_Tap a button below or use /approve\_all_' : '_All clear\! No jobs awaiting review_'
  ].join('\n');

  const replyMarkup = stats.reviewed > 0
    ? {
        inline_keyboard: [
          [
            { text: '✅ Approve all pending', callback_data: `approve_all:${callbackProfile}:80` },
            { text: '⭐ Approve top', callback_data: `approve_top:${callbackProfile}:noop` }
          ]
        ]
      }
    : undefined;

  await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'MarkdownV2',
    reply_markup: replyMarkup
  });
}

async function sendTelegramMessage(config, chatId, text) {
  await sendWithRateLimit(config, chatId, { text, parse_mode: 'MarkdownV2', disable_web_page_preview: true });
}

async function runNowFromTelegram(config, chatId) {
  if (!hasRunner()) {
    await sendTelegramMessage(config, chatId, 'Manual run is not available in this process\\.');
    return;
  }

  await sendTelegramMessage(config, chatId, `Starting a manual run for *${escapeMarkdown(profileLabel(config))}*\\.\\.\\.`);
  const result = await requestRun({ force: true });

  if (!result.ok && result.reason === 'busy') {
    await sendTelegramMessage(config, chatId, 'A run is already active\\. I will not start another one\\.');
    return;
  }

  if (!result.ok) {
    await sendTelegramMessage(config, chatId, `Manual run could not start: ${escapeMarkdown(result.reason || 'unknown')}\\.`);
    return;
  }

  if (result.result?.skipped) {
    await sendTelegramMessage(config, chatId, `Manual run skipped: ${escapeMarkdown(result.result.reason || 'busy')}\\.`);
    return;
  }

  await sendTelegramMessage(config, chatId, `Manual run finished for *${escapeMarkdown(profileLabel(config))}*\\. Use /status for counts\\.`);
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

export async function findJobByHash(config, jobHash, allConfigs = []) {
  const query = String(jobHash || '').trim();
  if (!query) return null;

  try {
    const store = await loadJobStore(config);
    const record = findMatchingJobRecord(store.jobs || [], query);
    if (record) return normalizeStoredJob(record);
  } catch {
    // Fall through to the review queue; Telegram buttons may have been sent
    // before the processed store was written or after it was reset.
  }

  try {
    const raw = await fs.readFile(config.reviewPath || path.resolve(process.cwd(), 'review', 'jobs.json'), 'utf8');
    const queue = JSON.parse(raw);
    const reviewRecord = findMatchingReviewRecord(Array.isArray(queue) ? queue : [], query, config);
    if (reviewRecord) return normalizeReviewJob(reviewRecord);
  } catch {
    // Nothing else to search.
  }

  // Telegram buttons can outlive a profile-store reset. Search the durable
  // global store and the other active profile stores before declaring a stale
  // callback unusable.
  const stores = [];
  try {
    const globalStore = await loadGlobalJobStore(config);
    stores.push(globalStore);
  } catch { /* ignore unavailable global store */ }
  for (const profileConfig of normalizeConfigList(allConfigs, config)) {
    if (profileConfig === config) continue;
    try {
      stores.push(await loadJobStore(profileConfig));
    } catch { /* ignore unavailable profile store */ }
  }
  for (const store of stores) {
    const record = findMatchingJobRecord(store.jobs || [], query);
    if (record) return normalizeStoredJob(record);
  }

  return null;
}

function findMatchingJobRecord(records, query) {
  const normalizedQuery = normalizeHashPrefix(query);
  if (!normalizedQuery) return null;

  return records.find((record) => {
    const hash = normalizeHashPrefix(record.job_hash || hashJob(record));
    return hash === normalizedQuery || hash.startsWith(normalizedQuery);
  }) || null;
}

function findMatchingReviewRecord(records, query, config = {}) {
  const normalizedQuery = normalizeHashPrefix(query);
  if (!normalizedQuery) return null;
  const profileName = String(config.profileName || '').toLowerCase();

  return records.find((record) => {
    if (profileName && String(record.profile || '').toLowerCase() !== profileName) return false;
    const nestedJob = record.job || {};
    const candidates = [
      record.job_hash,
      nestedJob.job_hash,
      hashJob(nestedJob),
      hashJob({
        ...nestedJob,
        applicationUrl: record.applicationUrl || nestedJob.applicationUrl || nestedJob.job_url
      })
    ].map(normalizeHashPrefix).filter(Boolean);

    return candidates.some((hash) => hash === normalizedQuery || hash.startsWith(normalizedQuery));
  }) || null;
}

function normalizeStoredJob(record = {}) {
  return {
    ...record,
    applicationUrl: record.applicationUrl || record.job_url || record.url || ''
  };
}

function normalizeReviewJob(record = {}) {
  const job = record.job || {};
  return {
    ...job,
    ...record,
    job,
    job_hash: record.job_hash || job.job_hash || hashJob(job),
    source_site: record.source_site || record.source || job.source_site || job.source || 'unknown',
    job_url: record.job_url || record.applicationUrl || job.job_url || job.applicationUrl || '',
    applicationUrl: record.applicationUrl || record.job_url || job.applicationUrl || job.job_url || '',
    title: record.title || job.title,
    company: record.company || job.company || '',
    score: record.score ?? record.analysis?.score ?? job.score,
    local: record.local || record.analysis?.local,
    gemini: record.gemini || record.analysis?.gemini,
    optimizer: record.optimizer || record.analysis?.optimizer,
    cover_letter: record.cover_letter || record.generatedCoverLetter || record.analysis?.cover_letter,
    application_answers: record.application_answers || record.analysis?.application_answers
  };
}

function normalizeHashPrefix(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
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

export async function sendOutcomeNotification(job, outcome, message, config = {}) {
  const recipient = resolveTelegramRecipient(config, { job });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  const emoji = outcome === 'interview_requested'
    ? '🎉'
    : outcome === 'rejected'
      ? '❌'
      : 'ℹ️';
  const title = outcome === 'interview_requested'
    ? 'Interview requested'
    : outcome === 'rejected'
      ? 'Application rejected'
      : String(outcome || 'Update');
  const jobLine = [job?.title, job?.company ? `@ ${job.company}` : ''].filter(Boolean).join(' ');
  const safeJobLine = escapeHtml(jobLine);
  const safeMessage = escapeHtml(message || '');
  const text = `<b>${escapeHtml(title)}</b>\n${safeJobLine ? `${safeJobLine}\n` : ''}${safeMessage}`;

  await sleep(350);
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: recipient.telegram_chat_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        await sleep(((data.parameters?.retry_after || 10) + 1) * 1000);
        continue;
      }
      return response;
    } catch (error) {
      await appendLog(`Telegram outcome notification error: ${error.message}`, config);
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
