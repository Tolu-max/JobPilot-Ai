import { appendLog } from './logger.js';
import { getJobRecord, upsertJobRecord, hashJob, loadJobStore, loadGlobalJobStore } from './jobStore.js';
import { stripHtml } from './utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertTelegramChatAllowed, resolveTelegramRecipient } from './notifications/router.js';
import { hasRunner, isPaused, requestRun, setPaused } from './botControl.js';
import { flushPendingApplyQueue } from './pipeline.js';
import { selectResumeForJob } from './resumeSelector.js';
import { getResumeProfile } from './resumeLibrary.js';
import { isDeterministicApplicationFailure } from './applicationRetryPolicy.js';

const POLL_INTERVAL_MS = 3000;
let pollingActive = false;

const MAX_REVIEW_NOTIFS_PER_RUN = 50;
const MIN_REVIEW_SCORE = 50;

// The getUpdates cursor belongs to the bot token, not to a profile. Keeping it
// in one file stops two profiles from overwriting each other's offset and
// replaying or skipping updates after a restart.
const polling = { lastUpdateId: 0, stateFile: '' };

// Review dedupe keys and the per-run notification cap are per profile. These
// used to be module-level, so tolu and sister shared one 50-message budget and
// wrote each other's dedupe keys into whichever profile dir flushed last.
const profileStates = new Map();

function profileStateKey(config) {
  return String(config?.profileName || config?.displayName || 'default').toLowerCase();
}

function profileState(config) {
  const key = profileStateKey(config);
  if (!profileStates.has(key)) {
    profileStates.set(key, {
      processedReviewKeys: new Set(),
      reviewNotifCount: 0,
      overflowCount: 0,
      loaded: false
    });
  }
  return profileStates.get(key);
}

function getStateFile(config) {
  return path.join(config?.profileDir || path.join(process.cwd(), 'data'), 'telegramState.json');
}

function getPollingStateFile(config) {
  return path.join(config?.rootDir || process.cwd(), 'data', 'telegramPolling.json');
}

async function loadPollingState(config) {
  polling.stateFile = getPollingStateFile(config);
  try {
    const state = JSON.parse(await fs.readFile(polling.stateFile, 'utf-8'));
    if (typeof state.lastUpdateId === 'number') polling.lastUpdateId = state.lastUpdateId;
    return;
  } catch { /* fall through to the legacy per-profile file */ }

  // Migration: the cursor used to live in <profileDir>/telegramState.json.
  try {
    const legacy = JSON.parse(await fs.readFile(getStateFile(config), 'utf-8'));
    if (typeof legacy.lastUpdateId === 'number') polling.lastUpdateId = legacy.lastUpdateId;
  } catch { /* first run */ }
}

async function savePollingState() {
  if (!polling.stateFile) return;
  try {
    await fs.mkdir(path.dirname(polling.stateFile), { recursive: true });
    await fs.writeFile(
      polling.stateFile,
      JSON.stringify({ lastUpdateId: polling.lastUpdateId }, null, 2),
      'utf-8'
    );
  } catch { /* non-fatal */ }
}

async function loadTelegramState(config) {
  const state = profileState(config);
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = await fs.readFile(getStateFile(config), 'utf-8');
    const stored = JSON.parse(raw);
    if (Array.isArray(stored.processedReviewKeys)) {
      state.processedReviewKeys = new Set(stored.processedReviewKeys);
    }
  } catch { /* first run */ }
}

async function saveTelegramState(config) {
  const state = profileState(config);
  try {
    const file = getStateFile(config);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const keysArray = Array.from(state.processedReviewKeys).slice(-2000);
    await fs.writeFile(file, JSON.stringify({
      processedReviewKeys: keysArray
    }, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

export function resetReviewNotifCount(config) {
  if (config) {
    const state = profileState(config);
    state.reviewNotifCount = 0;
    state.overflowCount = 0;
    state.processedReviewKeys.clear();
    return;
  }
  for (const state of profileStates.values()) {
    state.reviewNotifCount = 0;
    state.overflowCount = 0;
    state.processedReviewKeys.clear();
  }
}

function profileLabel(config) {
  return config?.displayName || config?.profileName || '';
}

function profileCallbackKey(config) {
  return String(config?.profileName || config?.displayName || 'profile').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'profile';
}

async function sendWithRateLimit(config, chatId, payload) {
  await sleep(350); // proactive spacing
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const cleanPayload = sanitizeTelegramPayload(payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, ...cleanPayload })
      });
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const waitMs = ((data.parameters?.retry_after || 2) + 1) * 1000;
        await sleep(waitMs);
        continue;
      }
      if (response.status >= 500) {
        await appendLog(`Telegram server error (${response.status}). Retrying...`, config);
        await sleep(2000);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
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
            return { ok: true, response: fallbackResponse };
          }
          const fbErrText = await fallbackResponse.text().catch(() => '');
          await appendLog(`Telegram sendMessage failed (${fallbackResponse.status}): ${fbErrText}`, config);
          return { ok: false, error: `HTTP ${fallbackResponse.status}: ${fbErrText}` };
        }
        await appendLog(`Telegram sendMessage failed (${response.status}): ${errText}`, config);
        return { ok: false, error: `HTTP ${response.status}: ${errText}` };
      }
      return { ok: true, response };
    } catch (error) {
      await appendLog(`Telegram sendMessage error: ${error.message}`, config);
      if (attempt < 2) await sleep(2000);
      else return { ok: false, error: error.message };
    }
  }
  return { ok: false, error: 'Max retries reached' };
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
  ['…', '...'], ['—', '-'], ['≥', '>='], ['ℹ️', 'Info:'],
  // Mojibake fallbacks for double-encoded upstream data (UTF-8 bytes interpreted as Latin-1)
  ['\u00f0\u0178\u201c\u2039', ''], ['\u00f0\u0178\u201c\u00ad', ''], ['\u00f0\u0178\u201c\u009d', ''], ['\u00f0\u0178\u201c\u201e', ''], ['\u00f0\u0178\u201c\u0161', ''], ['\u00f0\u0178\u0152\u00c2\u00b8', ''], ['\u00f0\u0178\u017d\u00a2', ''], ['\u00f0\u0178\u00a4\u00e2\u20ac\u201c', ''],
  ['\u00f0\u0178\u017f\u00a1', 'Review'], ['\u00f0\u0178\u017f\u00a2', 'Queued'], ['\u00e2\u02dc\u00b0\u00ef\u00b8\u2018', ''], ['\u00e2\u0153\u00a5', ''], ['\u00e2\u009d\u0152', ''], ['\u00e2\u0161\u00a0\u00ef\u00b8\u2018', 'Warning:'],
  ['\u00e2\u00ad\u0090', 'Score:'], ['\u00e2\u008f\u00ad\u00ef\u00b8\u2018', 'Ignored:'], ['\u00f0\u0178\u201c\u2014', ''], ['\u00e2\u0153\u00a8', ''],
  ['\u00e2\u20ac\u00a6', '...'], ['\u00e2\u20ac\u00a1', '-'], ['\u00e2\u2030\u00a5', '>='], ['\u00e2\u201e\u00b9\u00ef\u00b8\u2018', 'Info:']
];

function cleanTelegramText(value) {
  let cleaned = String(value || '');
  for (const [pattern, replacement] of TELEGRAM_TEXT_REPLACEMENTS) {
    cleaned = cleaned.split(pattern).join(replacement);
  }
  return cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export async function sendReviewNotification(job, score, config) {
  const recipient = resolveTelegramRecipient(config, { job });
  const minScore = MIN_REVIEW_SCORE;
  if (score < minScore) return false;
  return sendReviewNotificationHtml(job, score, config);
}

function formatCandidateName(config = {}) {
  // The profile already carries the right label (profiles/<name>/preferences.json
  // -> displayName). Do not pattern-match names here and do not default to a
  // real person, or a config that fails to load addresses the wrong candidate.
  const raw = String(config?.displayName || config?.profileName || '').trim();
  if (!raw) return 'Unknown profile';
  return escapeHtml(raw.charAt(0).toUpperCase() + raw.slice(1));
}

// Roughly half the scraped jobs arrive with no company. Naming a specific
// company in that case states something untrue, so fall back to the board the
// job came from instead.
function formatCompanyLine(job = {}) {
  const company = String(job.company || '').trim();
  const source = String(job.source_site || job.source || '').trim();
  const label = escapeHtml(company || 'Not listed');
  return source ? `${label} · ${escapeHtml(source)}` : label;
}

function resolveCandidateDisplayName(config = {}) {
  return formatCandidateName(config);
}

function resolveShortResumeName(config, job) {
  const selectedResume = selectResumeForJob(config, job);
  const resProfile = getResumeProfile(config.profileName || 'tolu', selectedResume.profileId);
  if (resProfile?.title) return escapeHtml(resProfile.title);
  const profileId = String(selectedResume.profileId || '').toLowerCase();
  if (profileId.includes('wordpress') || profileId.includes('seo')) return 'WordPress & Technical SEO';
  if (profileId.includes('fullstack') || profileId.includes('full-stack')) return 'Full Stack Web Developer';
  if (profileId.includes('frontend')) return 'Frontend / Web Developer';
  if (profileId.includes('ecommerce') || profileId.includes('shopify')) return 'E-Commerce & Shopify';
  if (profileId.includes('realestate')) return 'Real Estate VA';
  if (profileId.includes('support')) return 'Customer Support';
  if (profileId.includes('va')) return 'Virtual Assistant';
  if (profileId.includes('crm')) return 'CRM Specialist';
  return escapeHtml(selectedResume.profileId || 'Default Resume');
}

function formatClusterLabel(cluster = {}, isProvenWinner = false) {
  const name = String(cluster.clusterName || '').trim();
  if (name) {
    return escapeHtml(name.replace(/\s*\([^)]*\)/g, '').trim());
  }
  return isProvenWinner ? 'Proven Winner' : 'Selective Fit';
}

function formatHumanReadableFailure(errorReason = '') {
  const err = String(errorReason || '').toLowerCase();
  if (err.includes('captcha') || err.includes('recaptcha') || err.includes('capsolver') || err.includes('hcaptcha')) {
    return 'CAPTCHA verification could not be completed.';
  }
  if (err.includes('timeout') || err.includes('timed out')) {
    return 'Application request timed out.';
  }
  if (err.includes('closed') || err.includes('unavailable') || err.includes('no longer accepting')) {
    return 'Job opening is closed or no longer accepting submissions.';
  }
  if (err.includes('network') || err.includes('econnrefused') || err.includes('fetch')) {
    return 'Network connection error while submitting.';
  }
  if (err.includes('required') || err.includes('field') || err.includes('missing')) {
    return 'Application form required additional unmapped fields.';
  }
  if (err.includes('duplicate') || err.includes('already applied')) {
    return 'Application already submitted previously.';
  }
  if (err.includes('step') || err.includes('details') || err.includes('adapter')) {
    return 'Form submission could not be completed automatically.';
  }
  const clean = String(errorReason || '').replace(/Error:\s*/i, '').trim();
  if (clean.length > 0 && clean.length <= 80 && !/[{}<>]/.test(clean)) {
    return escapeHtml(clean);
  }
  return 'Application submission could not be completed.';
}

function formatStrongestReasons(job, analysis = {}) {
  const matchedSkills = Array.isArray(job.matchedSkills)
    ? job.matchedSkills
    : (Array.isArray(analysis.matchedSkills) ? analysis.matchedSkills : (job.local?.matchedSkills || []));
  
  if (matchedSkills.length > 0) {
    return matchedSkills.slice(0, 3).map(s => `• ${escapeHtml(s)}`).join('\n');
  }
  
  const reasons = Array.isArray(job.reasons)
    ? job.reasons
    : (Array.isArray(analysis.reasons) ? analysis.reasons : (job.local?.reasons || []));
  if (reasons.length > 0) {
    return reasons.slice(0, 2).map(r => `• ${escapeHtml(r)}`).join('\n');
  }

  return '• Strong skill alignment\n• Verified historical success pattern';
}

function extractTechnicalStackForTelegram(job = {}) {
  const text = [job.title, job.description, job.requirements, job.raw?.description, job.raw?.requirements]
    .filter(Boolean).join(' ');
  const patterns = [
    ['PHP', /\bphp\b/i], ['Laravel', /\blaravel\b/i], ['JavaScript/Node', /\bjavascript\b|\bnode(?:\.js|js)?\b/i],
    ['React', /\breact(?:\.js)?\b/i], ['Vue', /\bvue(?:\.js)?\b/i], ['WordPress', /\bwordpress\b/i],
    ['Shopify', /\bshopify\b/i], ['HTML/CSS', /\bhtml\b|\bcss\b/i], ['Python/Django', /\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b/i],
    ['Java/Spring', /\bjava\b|\bspring(?: boot| framework)?\b/i], ['.NET/C#', /\.net\b|\bdotnet\b|\bc#\b/i],
    ['Ruby/Rails', /\bruby\b|\brails\b/i], ['Go', /\bgolang\b|\bgo (?:developer|engineer)\b/i],
    ['Rust', /\brust\b/i], ['C/C++', /\bc\+\+?\b|\bc language\b/i], ['SQL/Databases', /\bsql\b|\bmysql\b|\bpostgres(?:ql)?\b/i],
    ['AWS/Cloud', /\baws\b|\bazure\b|\bgcp\b|\bcloud infrastructure\b/i], ['Kubernetes', /\bkubernetes\b|\bk8s\b/i]
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 6);
}

export async function sendAutoApplyNotification(job, analysis = {}, config = {}, status = 'success', errorReason = '') {
  // If starting, do not send starting status spam
  if (status === 'starting') return;

  const recipient = resolveTelegramRecipient(config, { job });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  const candidate = formatCandidateName(config);
  const title = escapeHtml(job.title || 'Untitled role');
  const company = formatCompanyLine(job);
  const url = job.applicationUrl || job.job_url || '';
  const score = analysis.score ?? analysis.application_score ?? analysis.local_score ?? 85;

  const cluster = job.cluster || analysis.cluster || {};
  const isProven = cluster.tier === 'PROVEN_WINNER' || score >= 85;
  const clusterLabel = formatClusterLabel(cluster, isProven);
  const shortResumeName = resolveShortResumeName(config, job);

  let text = '';

  if (status === 'success') {
    // 1. AUTO-APPLIED
    text = [
      `🟢 <b>JOBPILOT • APPLIED</b>`,
      `👤 ${candidate}`,
      `📌 ${title}`,
      `🏢 ${company}`,
      `📊 ${score}/100 • ${clusterLabel}`,
      `📄 ${shortResumeName}`,
      '',
      `✅ Submitted`,
      url ? `🔗 ${url}` : ''
    ].filter(Boolean).join('\n');
  } else if (status === 'failed') {
    // 2. APPLICATION FAILED
    const humanReason = formatHumanReadableFailure(errorReason);
    text = [
      `🔴 <b>JOBPILOT • FAILED</b>`,
      `👤 ${candidate}`,
      `📌 ${title}`,
      `🏢 ${company}`,
      `📊 ${score}/100 • ${clusterLabel}`,
      '',
      `❌ Application not submitted`,
      `⚠️ ${humanReason}`,
      url ? `🔗 ${url}` : ''
    ].filter(Boolean).join('\n');
  }

  const buttons = [];
  if (status === 'failed') {
    const jobHash = job.jobHash || job.job_hash || job.hash || hashJob(job) || '';
    const shortHash = jobHash.slice(0, 16);
    const callbackProfile = profileCallbackKey(config);
    const row = [];
    if (shortHash) {
      row.push({ text: '🔄 Retry Application', callback_data: `retry:${callbackProfile}:${shortHash}` });
    }
    if (url) {
      row.push({ text: 'Open Job 🌐', url });
    }
    if (row.length) buttons.push(row);
  } else if (status === 'success' && url) {
    buttons.push([{ text: 'View Posting 🌐', url }]);
  }

  if (text) {
    await sendWithRateLimit(config, recipient.telegram_chat_id, {
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {})
    });
  }
}

async function sendReviewNotificationHtml(job, score, config) {
  const minScore = MIN_REVIEW_SCORE;
  if (score < minScore) return false;

  const recipient = resolveTelegramRecipient(config, { job });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return false;

  const candidate = formatCandidateName(config);
  const callbackProfile = profileCallbackKey(config);
  const jobHash = job.jobHash || job.job_hash || job.hash || hashJob(job) || '';
  const shortHash = jobHash.slice(0, 16);

  await loadTelegramState(config);
  const state = profileState(config);
  const reviewKey = `${profileStateKey(config)}:${shortHash}:review`;
  if (state.processedReviewKeys.has(reviewKey)) {
    console.log(`[TelegramBot] SKIPPED job ${shortHash} due to dedup (processedReviewKeys)`);
    return false;
  }

  if (!job.isNewReview) {
    try {
      const existing = await getJobRecord(config, job);
      if (existing && ['pending_apply', 'applied', 'skipped', 'reviewed', 'manual_review', 'ignored', 'duplicate'].includes(existing.status)) {
        state.processedReviewKeys.add(reviewKey);
        await saveTelegramState(config);
        return false;
      }
    } catch { /* proceed if jobStore check fails */ }
  }

  const maxNotifs = Number.parseInt(config?.telegramMaxReviewNotifsPerRun ?? process.env.TELEGRAM_MAX_REVIEW_NOTIFS_PER_RUN, 10) || 5;
  if (state.reviewNotifCount >= maxNotifs) {
    state.overflowCount++;
    return false;
  }
  state.processedReviewKeys.add(reviewKey);
  state.reviewNotifCount++;
  await saveTelegramState(config);

  const title = escapeHtml(job.title || 'Untitled role');
  const company = formatCompanyLine(job);
  const url = job.applicationUrl || job.job_url || '';
  const location = escapeHtml(job.location || 'Remote');
  const salary = job.salary ? escapeHtml(job.salary) : null;
  const source = escapeHtml(job.source_site || job.source || 'Unknown');
  const summary = formatDescriptionForTelegram(job.description || job.raw?.description || '', 400);

  const cluster = job.cluster || job.local?.cluster || {};
  const clusterLabel = escapeHtml(cluster.clusterName || cluster.name || 'General Fit');
  const shortResumeName = resolveShortResumeName(config, job);
  const strongestReasons = formatStrongestReasons(job, job.local || {});

  let textLines = [];
  if (score >= 70) {
    textLines = [
      `🟡 <b>JOBPILOT • REVIEW</b>`,
      `👤 ${candidate}`,
      `📌 ${title}`,
      `🏢 ${company}`,
      `📊 ${score}/100 • ${clusterLabel}`,
      `📄 ${shortResumeName}`,
      `🔎`,
      strongestReasons,
      url ? `🔗 ${url}` : ''
    ];
  } else {
    textLines = [
      `🔵 <b>JOBPILOT • REVIEW</b>`,
      `👤 ${candidate}`,
      `📌 ${title}`,
      `🏢 ${company}`,
      `📊 ${score}/100 • Possible Fit`,
      `📄 ${shortResumeName}`,
      `⚠️ Weak historical fit`,
      url ? `🔗 ${url}` : ''
    ];
  }

  const text = textLines.filter(Boolean).join('\n');

  const buttons = [
    [
      { text: 'APPLY', callback_data: `accept:${callbackProfile}:${shortHash}` },
      { text: 'SKIP', callback_data: `reject:${callbackProfile}:${shortHash}` }
    ],
    [
      { text: 'Full Description', callback_data: `desc:${callbackProfile}:${shortHash}` }
    ]
  ];

  const result = await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
  
  if (!result?.ok) {
    console.error(`[TelegramBot] Failed to send review notification for job ${shortHash}: ${result?.error}`);
  }

  return Boolean(result?.ok);
}

export async function sendLifecycleNotification(event = {}, config = {}) {
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  const candidate = resolveCandidateDisplayName(config);
  const classification = event.classification || 'unknown';
  const jobTitle = escapeHtml(event.matchedJobTitle || event.extractedRoleTitle || event.subject || 'Role');
  const company = escapeHtml(event.company || 'Unknown company');
  const resumeProfileId = event.matchedResumeProfile || '';
  const resProfile = resumeProfileId ? getResumeProfile(config.profileName || 'tolu', resumeProfileId) : null;
  const resumeLabel = escapeHtml(resProfile?.title ? `${resProfile.title} (${resumeProfileId})` : resumeProfileId);
  const interview = event.interviewDetails || {};

  let text = '';
  const buttons = [];

  if (classification === 'client_interview') {
    text = [
      `🟢 <b>JOBPILOT • CLIENT INTERVIEW</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      `Stage: Client Interview`,
      interview.scheduledAt ? `Schedule: ${escapeHtml(interview.scheduledAt)} ${escapeHtml(interview.timezone || '')}` : '',
      resumeLabel ? `Resume: ${resumeLabel}` : '',
      '',
      `Historical Signal: Proven Winner`
    ].filter(Boolean).join('\n');

    if (interview.meetingUrl) buttons.push([{ text: 'Join Interview', url: interview.meetingUrl }]);
  } else if (classification === 'recruiter_interview') {
    text = [
      `🟢 <b>JOBPILOT • RECRUITER INTERVIEW</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      `Stage: Recruiter Interview`,
      interview.interviewer ? `Recruiter: ${escapeHtml(interview.interviewer)}` : '',
      interview.scheduledAt ? `Schedule: ${escapeHtml(interview.scheduledAt)} ${escapeHtml(interview.timezone || '')}` : '',
      resumeLabel ? `Resume: ${resumeLabel}` : '',
      '',
      `Historical Signal: Proven Winner`
    ].filter(Boolean).join('\n');

    if (interview.meetingUrl) buttons.push([{ text: 'Interview Link', url: interview.meetingUrl }]);
  } else if (classification === 'interview_prep') {
    text = [
      `🔵 <b>JOBPILOT • INTERVIEW PREP</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      `Stage: Client Interview Preparation`,
      interview.scheduledAt ? `Schedule: ${escapeHtml(interview.scheduledAt)} ${escapeHtml(interview.timezone || '')}` : '',
      resumeLabel ? `Resume: ${resumeLabel}` : ''
    ].filter(Boolean).join('\n');

    if (interview.meetingUrl) buttons.push([{ text: 'Prep Session Link', url: interview.meetingUrl }]);
  } else if (classification === 'offer') {
    text = [
      `🟢 <b>JOBPILOT • OFFER RECEIVED</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      `Stage: Offer Received`,
      resumeLabel ? `Resume: ${resumeLabel}` : ''
    ].filter(Boolean).join('\n');
  } else if (classification === 'rejection') {
    text = [
      `🔴 <b>JOBPILOT • REJECTED</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      resumeLabel ? `Resume: ${resumeLabel}` : '',
      `Reason: ${escapeHtml((event.excerpt || 'Position closed / not moving forward').slice(0, 180))}`,
      '',
      `Historical Signal: Closed cluster / no action required`
    ].filter(Boolean).join('\n');
  } else if (classification === 'recruiter_response' || classification === 'application_confirmation') {
    const stageName = classification === 'application_confirmation' ? 'Application Confirmed' : 'Recruiter Response / Under Review';
    text = [
      `🔵 <b>JOBPILOT • UPDATE</b>`,
      `👤 ${candidate}`,
      `📌 ${jobTitle}`,
      `🏢 ${company}`,
      '',
      `Status: ${stageName}`,
      resumeLabel ? `Resume: ${resumeLabel}` : ''
    ].filter(Boolean).join('\n');
  }

  if (text) {
    await sendWithRateLimit(config, recipient.telegram_chat_id, {
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
    });
  }
}

export async function sendOverflowSummary(config) {
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  const state = profileState(config);
  if (!config?.telegramBotToken || !recipient.telegram_chat_id || state.overflowCount === 0) return;
  const n = state.overflowCount;
  state.overflowCount = 0;
  const text = `📭 <b>${n} more job${n === 1 ? '' : 's'} found</b> but not shown (cap reached).\nUse /reviews to see all pending jobs.`;
  await sendWithRateLimit(config, recipient.telegram_chat_id, { text, parse_mode: 'HTML' });
}

export async function sendRunReviewDigest(config, newReviewJobs = []) {
  if (!Array.isArray(newReviewJobs) || newReviewJobs.length === 0) return;
  const minScore = Number.parseInt(config?.telegramReviewMinScore ?? 80, 10);
  const eligible = newReviewJobs
    .filter((j) => (j.score || 0) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (eligible.length === 0) return;

  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  const profile = escapeHtml(profileLabel(config));
  const callbackProfile = profileCallbackKey(config);

  if (eligible.length === 1) {
    const job = eligible[0];
    const hash = (job.job_hash || hashJob(job) || '').slice(0, 16);
    const title = escapeHtml(job.title || 'Untitled role');
    const url = job.job_url || job.applicationUrl || '';
    const company = job.company ? ` | ${escapeHtml(job.company)}` : '';
    const titleHtml = url ? `<a href="${escapeHtml(url)}"><b>${title}</b></a>` : `<b>${title}</b>`;
    const score = escapeHtml(job.score || 0);

    const lines = [
      `<b>New review job</b> [${profile}]`,
      '',
      `${titleHtml}`,
      `Score: <b>${score}</b>${company} | Status: Review`
    ];

    const row = [];
    row.push({ text: '✅ Queue Apply', callback_data: `accept:${callbackProfile}:${hash}` });
    row.push({ text: '❌ Skip', callback_data: `reject:${callbackProfile}:${hash}` });
    if (url) row.push({ text: '🔗 Open', url });

    await sendWithRateLimit(config, recipient.telegram_chat_id, {
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [row] }
    });
    return;
  }

  // Multi-job digest
  const topJobs = eligible.slice(0, 8);
  const lines = topJobs.map((job, idx) => {
    const title = escapeHtml(job.title || 'Untitled role');
    const url = job.job_url || job.applicationUrl;
    const score = escapeHtml(job.score || 0);
    const company = job.company ? ` • ${escapeHtml(job.company)}` : '';
    const titleHtml = url ? `<a href="${escapeHtml(url)}"><b>${title}</b></a>` : `<b>${title}</b>`;
    return `${idx + 1}. ${titleHtml}\n   Score: <b>${score}</b>${company}`;
  });

  const overflow = eligible.length > 8 ? `\n<i>...and ${eligible.length - 8} more. Use /reviews to view all.</i>` : '';
  const text = [
    `<b>New review jobs</b> [${profile}] (${eligible.length} found)`,
    '',
    ...lines,
    overflow
  ].filter(Boolean).join('\n');

  const buttons = [];

  for (let idx = 0; idx < topJobs.length; idx++) {
    const job = topJobs[idx];
    const hash = (job.job_hash || hashJob(job) || '').slice(0, 16);
    const num = idx + 1;
    const row = [];
    row.push({ text: `✅ #${num}`, callback_data: `accept:${callbackProfile}:${hash}` });
    row.push({ text: `❌ #${num}`, callback_data: `reject:${callbackProfile}:${hash}` });
    const url = job.job_url || job.applicationUrl;
    if (url) row.push({ text: `🔗 #${num}`, url });
    buttons.push(row);
  }

  const hasHighTier = eligible.some((j) => (j.score || 0) >= 85);
  if (hasHighTier) {
    buttons.push([
      { text: 'Approve High Tier (>=85)', callback_data: `approve_all:${callbackProfile}:85` }
    ]);
  } else {
    buttons.push([
      { text: `Approve all (>=${minScore})`, callback_data: `approve_all:${callbackProfile}:${minScore}` },
      { text: 'Approve top', callback_data: `approve_top:${callbackProfile}:noop` }
    ]);
  }

  await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons }
  });
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
      parts.push(`\n<b>${escapeHtml(line.replace(/:$/, ''))}</b>`);
    } else {
      parts.push(`• ${escapeHtml(line)}`);
    }
  }
  const result = parts.join('\n').trim();
  return result.length > maxChars ? result.slice(0, maxChars) + '\n<i>… (truncated)</i>' : result;
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

  await loadPollingState(config);
  console.log(`[TelegramBot] Started polling for review callbacks (lastUpdateId=${polling.lastUpdateId}).`);
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
        polling.lastUpdateId = Math.max(polling.lastUpdateId, update.update_id);
      }
      if (updates.length > 0) await savePollingState();
    } catch (error) {
      console.error(`[TelegramBot] Poll error: ${error.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function getUpdates(config) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`;
  const params = new URLSearchParams({
    offset: String(polling.lastUpdateId + 1),
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

  // Never fall back to the polling profile for an unknown callback target:
  // stale/malformed buttons must not cross profile boundaries.
  const profileConfig = findProfileConfig(profileName, allConfigs)
    || (!Array.isArray(allConfigs) ? config : null);
  if (!profileConfig) {
    await answerCallback(config, callbackQuery.id, '⚠️ Unknown profile button');
    await appendLog(`Rejected Telegram callback for unknown profile ${profileName}`, config);
    return;
  }
  const currentKeyboard = callbackQuery.message?.reply_markup?.inline_keyboard;
  if (!assertTelegramChatAllowed(profileConfig, chatId, { profile_id: profileConfig.profileName })) {
    await answerCallback(config, callbackQuery.id, 'This Telegram chat is not linked to that profile.');
    await appendLog(`Rejected Telegram callback for ${profileName}: chat ${chatId} is not linked`, profileConfig);
    return;
  }

  let record = await findJobByHash(profileConfig, jobHash, allConfigs);
  if (!record && callbackQuery.message) {
    record = await recoverJobFromTelegramMessage(callbackQuery.message, jobHash, profileConfig);
  }

  if (action === 'accept') {
    if (record) {
      if (record.status === 'applied' || record.status === 'hired') {
        await answerCallback(config, callbackQuery.id, '⚠️ Job already applied/submitted!');
        await editMessageButtons(config, chatId, messageId, '⚠️ ALREADY APPLIED', jobHash, currentKeyboard);
        return;
      }
      if (record.status === 'pending_apply') {
        await answerCallback(config, callbackQuery.id, 'ℹ️ Already queued to apply');
        await editMessageButtons(config, chatId, messageId, 'ALREADY QUEUED', jobHash, currentKeyboard);
        return;
      }
      if (record.status === 'expired' || record.status === 'closed') {
        await answerCallback(config, callbackQuery.id, '⚠️ Job is no longer available/expired.');
        await editMessageButtons(config, chatId, messageId, '⚠️ EXPIRED', jobHash, currentKeyboard);
        return;
      }

      await upsertJobRecord(profileConfig, record, 'pending_apply', {
        decision: 'apply',
        acceptedViaTelegram: true,
        acceptedAt: new Date().toISOString(),
        applicationUrl: record.applicationUrl || record.job_url || ''
      });
      const numMatch = currentKeyboard
        ?.flat()
        ?.find((btn) => btn.callback_data && btn.callback_data.includes(`:${jobHash}`))
        ?.text?.match(/#\d+/);
      const label = numMatch ? `${numMatch[0]} ` : '';
      await answerCallback(config, callbackQuery.id, `✅ ${label}Approved! Queued to apply.`);
      await editMessageButtons(config, chatId, messageId, 'QUEUED TO APPLY', jobHash, currentKeyboard);
      scheduleAutoFlushPendingApply(profileConfig, chatId);
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found in store');
    }
  } else if (action === 'reject') {
    if (record) {
      if (record.status === 'skipped') {
        await answerCallback(config, callbackQuery.id, 'ℹ️ Already skipped');
        await editMessageButtons(config, chatId, messageId, 'ALREADY SKIPPED', jobHash, currentKeyboard);
        return;
      }
      if (record.status === 'applied' || record.status === 'hired') {
        await answerCallback(config, callbackQuery.id, '⚠️ Already submitted; cannot skip');
        await editMessageButtons(config, chatId, messageId, 'ALREADY APPLIED', jobHash, currentKeyboard);
        return;
      }
      await upsertJobRecord(profileConfig, record, 'skipped', {
        decision: 'skip',
        rejectedViaTelegram: true,
        rejectedAt: new Date().toISOString()
      });
      const numMatch = currentKeyboard
        ?.flat()
        ?.find((btn) => btn.callback_data && btn.callback_data.includes(`:${jobHash}`))
        ?.text?.match(/#\d+/);
      const label = numMatch ? `${numMatch[0]} ` : '';
      await answerCallback(config, callbackQuery.id, `❌ ${label}Skipped`);
      await editMessageButtons(config, chatId, messageId, '❌ SKIPPED', jobHash, currentKeyboard);
    }
  } else if (action === 'retry') {
    if (record) {
      // A retry button must not reset a deterministic form/platform decision.
      // Complex forms and unknown ATS flows are actionable by a human, not
      // transient failures that the scheduler can safely repeat forever.
      if (record.terminal === true || isDeterministicApplicationFailure(record.reason)) {
        await answerCallback(config, callbackQuery.id, 'Manual review required; automatic retry stopped');
        await editMessageButtons(config, chatId, messageId, 'MANUAL REVIEW REQUIRED', jobHash, currentKeyboard);
        return;
      }
      await upsertJobRecord(profileConfig, record, 'pending_apply', {
        decision: 'apply',
        acceptedViaTelegram: true,
        acceptedAt: new Date().toISOString(),
        retryCount: 0,
        terminal: false,
        applicationUrl: record.applicationUrl || record.job_url || ''
      });
      await answerCallback(config, callbackQuery.id, 'Retrying application');
      await editMessageButtons(config, chatId, messageId, 'Retrying application', jobHash, currentKeyboard);
      try {
        await flushPendingApplyQueue(profileConfig);
        const updated = await findJobByHash(profileConfig, jobHash, allConfigs);
        await sendTelegramApplicationResult(profileConfig, chatId, updated || record);
      } catch (error) {
        await sendTelegramMessage(profileConfig, chatId, `Application retry failed: ${escapeHtml(error.message || 'unknown error')}.`);
      }
    } else {
      await answerCallback(config, callbackQuery.id, 'Job not found');
    }
  } else if (action === 'details') {
    if (record) {
      await answerCallback(config, callbackQuery.id, '📄 Sending details...');
      await sendJobDetails(config, chatId, record, profileName);
    } else {
      await answerCallback(config, callbackQuery.id, '⚠️ Job not found');
    }
  } else if (action === 'approve_all') {
    const minScore = Number.parseInt(profileConfig?.telegramReviewMinScore ?? 80, 10);
    const parsed = parseInt(jobHash, 10);
    const threshold = Number.isFinite(parsed) ? Math.min(parsed, minScore) : minScore;
    await answerCallback(config, callbackQuery.id, `✅ Approving reviewed jobs ≥ ${threshold}...`);
    await approveAllJobs(profileConfig, chatId, threshold);
    await editMessageButtons(config, chatId, messageId, '✅ All pending jobs approved');
    scheduleAutoFlushPendingApply(profileConfig, chatId);
  } else if (action === 'approve_top') {
    await answerCallback(config, callbackQuery.id, '✅ Approving top job...');
    await approveTopJob(profileConfig, chatId);
    await editMessageButtons(config, chatId, messageId, '✅ Top job approved');
    scheduleAutoFlushPendingApply(profileConfig, chatId);
  } else if (action === 'nav_reviews') {
    await answerCallback(config, callbackQuery.id, 'Opening reviews...');
    await sendPendingReviews(profileConfig, chatId);
  } else if (action === 'nav_status') {
    await answerCallback(config, callbackQuery.id, 'Fetching status...');
    await sendStatusMessage(profileConfig, chatId);
  } else if (action === 'nav_sites') {
    await answerCallback(config, callbackQuery.id, 'Fetching sites...');
    await sendSitesMessage(profileConfig, chatId);
  } else if (action === 'nav_run') {
    await answerCallback(config, callbackQuery.id, 'Starting run...');
    await runNowFromTelegram(profileConfig, chatId);
  } else if (action === 'nav_apply') {
    await answerCallback(config, callbackQuery.id, 'Applying pending...');
    await applyPendingFromTelegram(profileConfig, chatId);
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
  } else if (target.command === '/approve_all' || target.command === '/approve_score') {
    const minScore = Number.parseInt(targetConfig?.telegramReviewMinScore ?? 80, 10);
    const customThreshold = parseInt(target.args.find((part) => /^\d+$/.test(part)), 10);
    const threshold = Number.isFinite(customThreshold) ? customThreshold : minScore;
    await approveAllJobs(targetConfig, chatId, threshold);
  } else if (target.command === '/approve_top') {
    await approveTopJob(targetConfig, chatId);
  } else if (target.command === '/pause') {
    setPaused(true);
    await sendTelegramMessage(targetConfig, chatId, `<b>Paused</b> [${escapeHtml(profileLabel(targetConfig))}]\nScheduled runs will wait until /resume. Use /run to force one run now.`);
  } else if (target.command === '/resume') {
    setPaused(false);
    await sendTelegramMessage(targetConfig, chatId, `<b>Resumed</b> [${escapeHtml(profileLabel(targetConfig))}]\nScheduled runs are active again.`);
  } else if (target.command === '/run' || target.command === '/run_now') {
    await runNowFromTelegram(targetConfig, chatId);
  } else if (target.command === '/apply_pending' || target.command === '/flush_pending') {
    await applyPendingFromTelegram(targetConfig, chatId);
  } else if (target.command === '/skip_all' || target.command === '/reject_all') {
    await skipAllJobs(targetConfig, chatId);
  }
}

async function sendTelegramApplicationResult(config, chatId, record = {}) {
  const status = String(record.status || 'unknown');
  const title = escapeHtml(record.title || 'Job');
  const url = record.job_url || record.applicationUrl || record.url || record.job?.job_url || record.job?.applicationUrl || '';
  if (status === 'applied') {
    await sendTelegramMessage(config, chatId, `<b>Application confirmed</b>\n${title}`);
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
    text: `<b>${escapeHtml(label)}</b>\n${title}\n${escapeHtml(conciseReason)}.`,
    parse_mode: 'HTML',
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
    await sendTelegramMessage(config, chatId, '⚠️ Could not read job store.');
    return;
  }

  const eligible = (store.jobs || [])
    .filter((j) => j.status === 'reviewed' && (j.score || 0) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (eligible.length === 0) {
    await sendTelegramMessage(config, chatId, `✨ No reviewed jobs with score >= ${minScore} found.`);
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
  const text = `✅ <b>${eligible.length} job${eligible.length === 1 ? '' : 's'} approved</b> [${escapeHtml(profileName)}]\n<i>Score >= ${minScore} | Will apply on next run</i>`;
  await sendTelegramMessage(config, chatId, text);
}

async function approveTopJob(config, chatId) {
  let store;
  try {
    store = await loadJobStore(config);
  } catch {
    await sendTelegramMessage(config, chatId, '⚠️ Could not read job store.');
    return;
  }

  const reviewed = (store.jobs || [])
    .filter((j) => j.status === 'reviewed')
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (reviewed.length === 0) {
    await sendTelegramMessage(config, chatId, '✨ No pending jobs to approve.');
    return;
  }

  const top = reviewed[0];
  await upsertJobRecord(config, top, 'pending_apply', {
    decision: 'apply',
    acceptedViaTelegram: true,
    acceptedAt: new Date().toISOString(),
    applicationUrl: top.applicationUrl || top.job_url || ''
  });

  const text = `✅ <b>Top job approved!</b>\n<b>${escapeHtml(top.title || 'Unknown')}</b> — Score: ${top.score || 0}\n<i>Will apply on next run</i>`;
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
    `📄 <b>Job Details</b>`,
    `<b>${escapeHtml(record.title || 'Unknown')}</b>`,
    record.company ? `🏢 ${formatCompanyLine(record)}` : '',
    `⭐ Score: ${record.score || 0}`,
    url ? `🔗 <a href="${escapeHtml(url)}">Open Link</a>` : '',
    '',
    formattedDesc
  ].filter(Boolean).join('\n');

  await sendWithRateLimit(config, chatId, {
    text,
    parse_mode: 'HTML',
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
}

async function sendPendingReviewsHtml(config, chatId) {
  let reviews = [];
  try {
    const store = await loadJobStore(config);
    reviews = (store.jobs || [])
      .filter((j) => j.status === 'reviewed' || j.status === 'pending_apply' || j.status === 'manual_review')
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 8);
  } catch { /* empty */ }

  if (reviews.length === 0) {
    await sendWithRateLimit(config, chatId, { text: '<b>Pending reviews</b>\nNo pending reviews. All caught up.', parse_mode: 'HTML' });
    return;
  }

  const profile = escapeHtml(profileLabel(config));
  const callbackProfile = profileCallbackKey(config);

  const lines = reviews.map((job, index) => {
    const status = job.status === 'pending_apply'
      ? 'Queued'
      : job.status === 'manual_review' ? 'Manual review' : 'Review';
    const score = escapeHtml(job.score || 0);
    const title = escapeHtml(job.title || 'Untitled role');
    const url = job.job_url || job.applicationUrl;
    const company = job.company ? ` | ${escapeHtml(job.company)}` : '';
    const titleHtml = url ? `<a href="${escapeHtml(url)}">${title}</a>` : title;
    return `${index + 1}. <b>${titleHtml}</b>\nScore: ${score}${company} | Status: ${status}`;
  });

  const buttons = reviews.map((job, index) => {
    const hash = (job.job_hash || hashJob(job) || '').slice(0, 16);
    const num = index + 1;
    const row = [];
    const url = job.job_url || job.applicationUrl;
    if (url) row.push({ text: `#${num} Open`, url });
    row.push({ text: `#${num} Apply`, callback_data: `accept:${callbackProfile}:${hash}` });
    row.push({ text: `#${num} Skip`, callback_data: `reject:${callbackProfile}:${hash}` });
    return row;
  });

  const minScore = Number.parseInt(config?.telegramReviewMinScore ?? 80, 10);
  if (reviews.length > 0) {
    buttons.push([
      { text: `Approve all (>=${minScore})`, callback_data: `approve_all:${callbackProfile}:${minScore}` },
      { text: 'Approve top', callback_data: `approve_top:${callbackProfile}:noop` }
    ]);
  }

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
  const callbackProfile = profileCallbackKey(config);
  const text = [
    '<b>JobPilot Bot — Commands</b>',
    '',
    '<b>Review & Queue</b>',
    '/reviews — show pending reviewed jobs',
    '/approve_all — queue reviewed jobs (>=75 or e.g. /approve_all 80)',
    '/skip_all — skip all pending reviewed jobs',
    '/apply_pending — submit queued applications now',
    '',
    '<b>Status & Control</b>',
    '/status — show stats for this profile (or /status all)',
    '/run — trigger a scraper run now',
    '/pause — pause scheduled automation',
    '/resume — resume scheduled automation',
    '/help — show this command guide',
    '',
    profiles ? `Profiles: <code>${escapeHtml(profiles)}</code>` : '',
    `Scheduler: <b>${isPaused() ? 'paused' : 'active'}</b>${hasRunner() ? '' : ' (manual run unavailable)'}`,
    '<i>Tip: target a profile by name, e.g. /reviews tolu or /approve_all sister</i>'
  ].filter(Boolean).join('\n');

  const buttons = [
    [
      { text: '📋 Reviews', callback_data: `nav_reviews:${callbackProfile}:0` },
      { text: '📊 Status', callback_data: `nav_status:${callbackProfile}:0` }
    ],
    [
      { text: '🚀 Run Now', callback_data: `nav_run:${callbackProfile}:0` },
      { text: '⚡ Apply Pending', callback_data: `nav_apply:${callbackProfile}:0` }
    ]
  ];

  await sendWithRateLimit(config, chatId, {
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function sendStatusMessage(config, chatId) {
  let stats = { total: 0, applied: 0, reviewed: 0, manual_review: 0, pending_apply: 0, ignored: 0, failed: 0 };
  let lastRunTimestamp = 'Unknown';
  try {
    const store = await loadJobStore(config);
    const jobs = store.jobs || [];
    stats.total = jobs.length;
    stats.applied = jobs.filter((j) => j.status === 'applied').length;
    stats.reviewed = jobs.filter((j) => j.status === 'reviewed').length;
    stats.manual_review = jobs.filter((j) => j.status === 'manual_review').length;
    stats.pending_apply = jobs.filter((j) => j.status === 'pending_apply').length;
    stats.ignored = jobs.filter((j) => j.status === 'ignored').length;
    stats.failed = jobs.filter((j) => j.status === 'failed').length;
    
    let maxDate = 0;
    for (const j of jobs) {
      if (j.updatedAt) {
        const ts = new Date(j.updatedAt).getTime();
        if (ts > maxDate) maxDate = ts;
      }
    }
    if (maxDate > 0) lastRunTimestamp = new Date(maxDate).toISOString();
  } catch { /* empty */ }

  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  
  const profileName = profileLabel(config);
  const callbackProfile = profileCallbackKey(config);
  const text = [
    `📊 <b>Status Overview</b> [${escapeHtml(profileName)}]`,
    '',
    `Bot Uptime: <b>${uptimeHours}h ${uptimeMinutes}m</b>`,
    `Last Run: <b>${lastRunTimestamp}</b>`,
    '',
    `Total processed: <b>${stats.total}</b>`,
    `✅ Applied: <b>${stats.applied}</b>`,
    `🟡 Pending review: <b>${stats.reviewed}</b>`,
    stats.manual_review > 0 ? `🟠 Manual review: <b>${stats.manual_review}</b>` : '',
    `🟢 Queued to apply: <b>${stats.pending_apply}</b>`,
    `⏭️ Ignored: <b>${stats.ignored}</b>`,
    `❌ Failed: <b>${stats.failed}</b>`
  ].filter(Boolean).join('\n');

  const buttons = [];
  const actionRow = [];
  if (stats.reviewed > 0) {
    actionRow.push({ text: `📋 Reviews (${stats.reviewed})`, callback_data: `nav_reviews:${callbackProfile}:0` });
  }
  if (stats.pending_apply > 0) {
    actionRow.push({ text: `⚡ Apply Pending (${stats.pending_apply})`, callback_data: `nav_apply:${callbackProfile}:0` });
  }
  if (actionRow.length > 0) buttons.push(actionRow);
  buttons.push([
    { text: '🚀 Run Scraper', callback_data: `nav_run:${callbackProfile}:0` },
    { text: '🌐 Sites', callback_data: `nav_sites:${callbackProfile}:0` }
  ]);

  await sendWithRateLimit(config, chatId, {
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
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
    const mode = siteConfig.autoApplyEnabled ? 'auto-apply' : 'review-only';
    const icon = status === 'ok' ? '✅' : (status === 'failed' || status === 'error' ? '⚠️' : '⚪');
    return `${icon} <b>${escapeHtml(site)}</b>: ${escapeHtml(status)} (${count} jobs) • <i>${mode}</i>`;
  });

  const callbackProfile = profileCallbackKey(config);
  const text = [
    `🌐 <b>Enabled Scrapers</b> [${escapeHtml(profileLabel(config))}]`,
    '',
    ...lines
  ].join('\n');

  const buttons = [
    [
      { text: '🚀 Run Scraper', callback_data: `nav_run:${callbackProfile}:0` },
      { text: '📊 Status', callback_data: `nav_status:${callbackProfile}:0` }
    ]
  ];

  await sendWithRateLimit(config, chatId, {
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

/**
 * Send the daily 8AM summary (called by scheduler).
 */
export async function sendDailySummary(config) {
  const recipient = resolveTelegramRecipient(config, { profile_id: config?.profileName });
  if (!config?.telegramBotToken || !recipient.telegram_chat_id) return;

  let stats = { applied: 0, reviewed: 0, pendingApply: 0, failed: 0, total: 0, highTierCount: 0 };
  try {
    const store = await loadJobStore(config);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = (store.jobs || []).filter((j) => j.updatedAt && new Date(j.updatedAt).getTime() >= cutoff);
    stats.total = recent.length;
    stats.applied = recent.filter((j) => j.status === 'applied').length;
    stats.reviewed = recent.filter((j) => j.status === 'reviewed').length;
    stats.pendingApply = recent.filter((j) => j.status === 'pending_apply').length;
    stats.failed = recent.filter((j) => j.status === 'failed').length;
    // Count all-time high-tier reviewed jobs (not just last 24h)
    stats.highTierCount = (store.jobs || []).filter((j) => j.status === 'reviewed' && (j.score || 0) >= 85).length;
  } catch { /* skip */ }

  const profileName = profileLabel(config);
  const callbackProfile = profileCallbackKey(config);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const pendingLine = stats.reviewed > 0
    ? `🟡 Pending review: <b>${stats.reviewed}</b>`
    : `🟡 Pending review: 0`;

  const text = [
    `☀️ <b>Daily Summary</b> [${escapeHtml(profileName)}] — ${escapeHtml(today)}`,
    '',
    `📊 Last 24h: ${stats.total} jobs processed`,
    `✅ Applied: ${stats.applied}`,
    pendingLine,
    stats.pendingApply > 0 ? `🟢 Queued to apply: <b>${stats.pendingApply}</b>` : '',
    `❌ Failed: ${stats.failed}`,
    '',
    stats.reviewed > 0
      ? `<i>Tap below to review each job individually, or use /reviews</i>`
      : `<i>All clear! No jobs awaiting review</i>`
  ].filter(Boolean).join('\n');

  const buttons = [];
  if (stats.reviewed > 0) {
    buttons.push([{ text: `📋 View & Review Jobs (${stats.reviewed})`, callback_data: `nav_reviews:${callbackProfile}:0` }]);
    if (stats.highTierCount > 0) {
      buttons.push([{ text: `⭐ Approve High Tier (≥85) — ${stats.highTierCount} job${stats.highTierCount === 1 ? '' : 's'}`, callback_data: `approve_all:${callbackProfile}:85` }]);
    }
  }
  if (stats.pendingApply > 0) {
    buttons.push([{ text: `⚡ Apply Queued Now (${stats.pendingApply})`, callback_data: `nav_apply:${callbackProfile}:0` }]);
  }

  await sendWithRateLimit(config, recipient.telegram_chat_id, {
    text,
    parse_mode: 'HTML',
    ...(buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {})
  });
}

async function sendTelegramMessage(config, chatId, text) {
  await sendWithRateLimit(config, chatId, { text, parse_mode: 'HTML', disable_web_page_preview: true });
}

async function runNowFromTelegram(config, chatId) {
  if (!hasRunner()) {
    await sendTelegramMessage(config, chatId, 'Manual run is not available in this process.');
    return;
  }

  await sendTelegramMessage(config, chatId, `Starting a manual run for <b>${escapeHtml(profileLabel(config))}</b>...`);
  const result = await requestRun({ force: true });

  if (!result.ok && result.reason === 'busy') {
    await sendTelegramMessage(config, chatId, 'A run is already active. I will not start another one.');
    return;
  }

  if (!result.ok) {
    await sendTelegramMessage(config, chatId, `Manual run could not start: ${escapeHtml(result.reason || 'unknown')}.`);
    return;
  }

  if (result.result?.skipped) {
    await sendTelegramMessage(config, chatId, `Manual run skipped: ${escapeHtml(result.result.reason || 'busy')}.`);
    return;
  }

  const callbackProfile = profileCallbackKey(config);
  const buttons = [
    [
      { text: '📊 Check Status', callback_data: `nav_status:${callbackProfile}:0` },
      { text: '📋 View Reviews', callback_data: `nav_reviews:${callbackProfile}:0` }
    ]
  ];
  await sendWithRateLimit(config, chatId, {
    text: `Manual run finished for <b>${escapeHtml(profileLabel(config))}</b>.`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

const activePendingApplyRuns = new Map();

async function applyPendingFromTelegram(config, chatId) {
  const profileKey = config?.profileName || 'default';
  if (activePendingApplyRuns.has(profileKey)) {
    if (config.telegramApplyQueueProgressNotifications !== false) {
      await sendTelegramMessage(config, chatId, `An approved application run is already in progress for <b>${escapeHtml(profileLabel(config))}</b>.`);
    }
    return;
  }
  const runPromise = applyPendingFromTelegramInternal(config, chatId);
  activePendingApplyRuns.set(profileKey, runPromise);
  try {
    await runPromise;
  } finally {
    if (activePendingApplyRuns.get(profileKey) === runPromise) activePendingApplyRuns.delete(profileKey);
  }
}

async function applyPendingFromTelegramInternal(config, chatId) {
  const store = await loadJobStore(config).catch(() => ({ jobs: [] }));
  const pending = (store.jobs || []).filter((job) => job.status === 'pending_apply');
  if (pending.length === 0) {
    await sendTelegramMessage(config, chatId, `✨ No queued applications for <b>${escapeHtml(profileLabel(config))}</b>.\nUse /reviews or /approve_all first.`);
    return;
  }

  if (config.telegramApplyQueueProgressNotifications !== false) {
    await sendTelegramMessage(config, chatId, `Starting ${pending.length} approved application(s) for <b>${escapeHtml(profileLabel(config))}</b>...`);
  }
  try {
    const summary = await flushPendingApplyQueue(config);
    const updatedStore = await loadJobStore(config).catch(() => ({ jobs: [] }));
    const remaining = (updatedStore.jobs || []).filter((job) => job.status === 'pending_apply').length;
    if (config.telegramApplyQueueProgressNotifications !== false) {
      await sendTelegramMessage(config, chatId, formatApplyQueueSummary(summary, remaining, profileLabel(config)));
    }
  } catch (error) {
    await sendTelegramMessage(config, chatId, `Approved application queue failed: ${escapeHtml(error.message || 'unknown error')}.`);
  }
}

export function formatApplyQueueSummary(summary = {}, remaining = 0, profile = 'profile') {
  const outcomes = Array.isArray(summary.outcomes) ? summary.outcomes : [];
  const drained = Number(remaining) === 0;
  const lines = [
    `<b>Approved application queue ${drained ? 'drained' : 'partially processed'}</b> [${escapeHtml(profile)}]`,
    `Submitted successfully: <b>${Number(summary.applied || 0)}</b>`,
    `Moved to manual review: <b>${Number(summary.manualReview || 0)}</b>`,
    `Failed: <b>${Number(summary.failed || 0)}</b>`,
    `Held/blocked: <b>${Number(summary.held || 0) + Number(summary.blocked || 0)}</b>`,
    `Still queued: <b>${Number(remaining) || 0}</b>`
  ];
  if (outcomes.length > 0) {
    lines.push('', '<b>Per-role outcomes</b>');
    for (const outcome of outcomes.slice(0, 30)) {
      const label = outcome.status === 'applied'
        ? 'SUBMITTED'
        : outcome.status === 'manual_review'
          ? 'MANUAL REVIEW'
          : outcome.status === 'failed'
            ? 'FAILED'
            : outcome.status.toUpperCase();
      const reason = outcome.reason ? ` — ${escapeHtml(String(outcome.reason).slice(0, 180))}` : '';
      lines.push(`• <b>${escapeHtml(label)}</b>: ${escapeHtml(outcome.title || 'Untitled role')}${reason}`);
    }
    if (outcomes.length > 30) lines.push(`…and ${outcomes.length - 30} more role outcome(s).`);
  }
  lines.push('', drained && Number(summary.applied || 0) > 0
    ? 'The queue is empty because eligible roles were processed; this does not mean every role was submitted successfully.'
    : drained
      ? 'The queue is empty, but no role was successfully submitted in this pass.'
      : 'Roles still queued need another run or review.');
  return lines.join('\n');
}

async function skipAllJobs(config, chatId) {
  let store;
  try {
    store = await loadJobStore(config);
  } catch {
    await sendTelegramMessage(config, chatId, '⚠️ Could not read job store.');
    return;
  }

  const eligible = (store.jobs || []).filter((j) => j.status === 'reviewed');
  if (eligible.length === 0) {
    await sendTelegramMessage(config, chatId, '✨ No pending reviews to skip.');
    return;
  }

  for (const record of eligible) {
    await upsertJobRecord(config, record, 'skipped', {
      decision: 'skip',
      rejectedViaTelegram: true,
      rejectedAt: new Date().toISOString()
    });
  }

  const profileName = profileLabel(config);
  await sendTelegramMessage(config, chatId, `⏭️ <b>${eligible.length} job${eligible.length === 1 ? '' : 's'} skipped</b> [${escapeHtml(profileName)}].`);
}

async function answerCallback(config, callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  }).catch(() => {});
}

const messageKeyboardCache = new Map();
const pendingMarkupEdits = new Map();
const pendingApplyTimers = new Map();

function scheduleAutoFlushPendingApply(profileConfig, chatId) {
  const profileKey = profileConfig?.profileName || 'default';
  if (pendingApplyTimers.has(profileKey)) {
    clearTimeout(pendingApplyTimers.get(profileKey));
  }

  const timer = setTimeout(async () => {
    pendingApplyTimers.delete(profileKey);
    console.log(`[TelegramBot] Auto-triggering pending apply flush for ${profileKey}`);
    try {
      await applyPendingFromTelegram(profileConfig, chatId);
    } catch (err) {
      console.warn(`[TelegramBot] Auto-flush pending apply failed: ${err.message}`);
    }
  }, 3500);

  pendingApplyTimers.set(profileKey, timer);
}

async function editMessageButtons(config, chatId, messageId, statusText, targetHash = null, currentKeyboard = null) {
  if (!config?.telegramBotToken || !chatId || !messageId) return;

  const cacheKey = `${chatId}:${messageId}`;
  let baseKeyboard = messageKeyboardCache.get(cacheKey);
  if (!baseKeyboard && Array.isArray(currentKeyboard) && currentKeyboard.length > 0) {
    baseKeyboard = JSON.parse(JSON.stringify(currentKeyboard));
  }
  if (!baseKeyboard) return;

  const isDigest = baseKeyboard.length > 2 && baseKeyboard.some((row) =>
    Array.isArray(row) && row.some((btn) => btn.text && /#\d+/.test(btn.text))
  );

  let newKeyboard;

  if (isDigest && targetHash) {
    let matched = false;
    newKeyboard = baseKeyboard.map((row) => {
      if (!Array.isArray(row)) return row;
      const matchingBtn = row.find((btn) => btn.callback_data && btn.callback_data.includes(`:${targetHash}`));
      if (!matchingBtn) return row;
      matched = true;

      const numMatch = row.map((btn) => btn.text).join(' ').match(/#\d+/);
      const num = numMatch ? `${numMatch[0]} ` : '';
      const isReject = /skip|reject/i.test(statusText);
      const icon = isReject ? '❌' : '✅';
      const label = isReject ? `${num}Skipped` : `${num}Queued`;

      const linkBtn = row.find((btn) => btn.url);
      const updatedRow = [{ text: `${icon} ${label}`.trim(), callback_data: 'noop' }];
      if (linkBtn) updatedRow.push(linkBtn);
      return updatedRow;
    });

    if (!matched) {
      return; // Do not destroy the menu if target row wasn't found
    }
  } else if (targetHash) {
    newKeyboard = [[{ text: statusText, callback_data: 'noop' }]];
    const linkBtn = baseKeyboard.flat().find((btn) => btn.url);
    if (linkBtn) {
      newKeyboard.push([linkBtn]);
    }
  } else {
    newKeyboard = [[{ text: statusText, callback_data: 'noop' }]];
  }

  // Update in-memory cache immediately so concurrent or rapid clicks stack on top of each other!
  messageKeyboardCache.set(cacheKey, newKeyboard);

  if (pendingMarkupEdits.has(cacheKey)) {
    clearTimeout(pendingMarkupEdits.get(cacheKey));
  }

  const timer = setTimeout(async () => {
    pendingMarkupEdits.delete(cacheKey);
    const finalKeyboard = messageKeyboardCache.get(cacheKey);
    if (!finalKeyboard) return;

    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: finalKeyboard }
      })
    }).catch(() => {});
  }, 120);

  pendingMarkupEdits.set(cacheKey, timer);
}

export async function recoverJobFromTelegramMessage(message = {}, jobHash = '', config = {}) {
  const text = message.text || message.caption || '';
  const inlineKeyboard = message.reply_markup?.inline_keyboard || [];

  // 1. Extract URL from inline keyboard buttons or message text
  let url = '';
  for (const row of inlineKeyboard) {
    for (const btn of row) {
      if (btn.url && /^https?:\/\//i.test(btn.url)) {
        url = btn.url;
        break;
      }
    }
    if (url) break;
  }
  if (!url) {
    const urlMatch = text.match(/🔗\s*(https?:\/\/[^\s\n\r]+)/i) || text.match(/https?:\/\/[^\s\n\r<>"']+/i);
    if (urlMatch) url = urlMatch[1].trim();
  }

  // 2. Extract Title: 📌 <title>
  const titleMatch = text.match(/📌\s*([^\n\r]+)/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Application';

  // 3. Extract Company and Source: 🏢 <company> [· @ source]
  const companyMatch = text.match(/🏢\s*([^\n\r]+)/i);
  let company = '';
  let source = '';
  if (companyMatch) {
    const rawCompanyLine = companyMatch[1].trim();
    if (rawCompanyLine.includes('·')) {
      const parts = rawCompanyLine.split('·');
      company = parts[0].trim();
      source = parts[1].trim().toLowerCase();
    } else if (rawCompanyLine.includes('•')) {
      const parts = rawCompanyLine.split('•');
      company = parts[0].trim();
      source = parts[1].trim().toLowerCase();
    } else {
      company = rawCompanyLine;
    }
  }

  // 4. Derive source from URL if unknown
  if (!source && url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('breezy.hr')) source = 'breezyhr';
      else if (host.includes('bruntwork')) source = 'bruntwork';
      else if (host.includes('greenhouse.io')) source = 'greenhouse';
      else if (host.includes('ashbyhq.com')) source = 'ashby';
      else if (host.includes('lever.co')) source = 'lever';
      else if (host.includes('workable.com')) source = 'workable';
      else if (host.includes('smartrecruiters.com')) source = 'smartrecruiters';
      else if (host.includes('jobberman.com')) source = 'jobberman';
      else if (host.includes('hotnigerianjobs.com')) source = 'hotnigerianjobs';
      else if (host.includes('myjobmag.com')) source = 'myjobmag';
      else if (host.includes('himalayas.app')) source = 'himalayas';
      else if (host.includes('arbeitnow.com')) source = 'arbeitnow';
      else if (host.includes('weworkremotely.com')) source = 'weworkremotely';
      else if (host.includes('remotive.com')) source = 'remotive';
      else if (host.includes('workingnomads.com')) source = 'workingnomads';
      else if (host.includes('jobicy.com')) source = 'jobicy';
      else if (host.includes('themuse.com')) source = 'themuse';
    } catch {}
  }
  if (!source) source = 'unknown';

  // 5. Extract Score: 📊 (\d+)/100
  const scoreMatch = text.match(/📊\s*(\d+)\/100/i);
  const score = scoreMatch ? Number.parseInt(scoreMatch[1], 10) : 85;

  const fallbackHash = jobHash || hashJob({ applicationUrl: url, title, company, source });

  const record = {
    job_hash: fallbackHash,
    source_site: source,
    source,
    job_url: url,
    applicationUrl: url,
    title,
    company: company || 'Company',
    score,
    status: 'reviewed',
    is_remote: true,
    location: 'Remote',
    updatedAt: new Date().toISOString(),
    recoveredFromTelegram: true
  };

  if (config?.jobStorePath) {
    try {
      await upsertJobRecord(config, record, record.status, {
        score,
        is_remote: true,
        recoveredFromTelegram: true
      });
      console.log(`[TelegramBot] Successfully recovered job "${title}" (${fallbackHash}) from Telegram message into store`);
    } catch (err) {
      console.warn(`[TelegramBot] Failed to persist recovered job: ${err.message}`);
    }
  }

  return normalizeStoredJob(record);
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

export {
  handleTextCommand,
  handleCallback,
  skipAllJobs,
  applyPendingFromTelegram,
  sendStatusMessage,
  sendSitesMessage,
  sendHelpMessage
};
