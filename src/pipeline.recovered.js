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
import { selectResumeForJob } from './resumeSelector.js';
import { isDeterministicApplicationFailure } from './applicationRetryPolicy.js';
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

  if (maxJobs !== null) console.log(`  ${pc.dim('max-jobs:')}     ${pc.white(maxJobs)}`);
  if (maxApplies !== null) console.log(`  ${pc.dim('max-applies:')}  ${pc.white(maxApplies)}`);
  if (sites) console.log(`  ${pc.dim('sites:')}        ${pc.white(sites)}`);
  if (config.allowGatewayAutoSubmit) console.log(`  ${pc.dim('gateway:')}      ${pc.white('audited handoff enabled')}`);
  if (reprocessNonApplied) console.log(`  ${pc.dim('reprocess:')}    ${pc.white('non-applied records only')}`);
  console.log();

  const start = Date.now();
  try {
    const results = await runJobHunt(config, { reprocessNonApplied });
    const summary = summarizeResults(results, results.runSummary);
    const took = ((Date.now() - start) / 1000).toFixed(1);

    console.log();
    console.log(`  ${pc.bold('Done')} ${pc.dim(`in ${took}s`)}`);
    const lines = [
      ['Scraped', summary.scraped],
      ['Ignored', summary.ignored],
      ['Queued review', summary.queuedReview],
      ['Apply attempts', summary.autoApplyAttempts],
      ['Auto-applied', summary.autoApplied],
      ['Deduped', summary.deduped],
      ['Errors', summary.errors]
    ];
    for (const [key, value] of lines) {
      console.log(`    ${pc.dim(key.padEnd(14))}${pc.white(String(value))}`);
    }

    console.log();
    console.log(pc.dim('  jobpilot status     see profile rollup'));
  const jobs = filterStaleScrapedJobs(scrapeResult.jobs, config);
    console.log();
  } catch (err) {
    await appendLog(`cmdRun fatal: ${err.stack || err.message}`, config);
    console.error();
    const file = getStateFile(config);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const keysArray = Array.from(state.processedReviewKeys).slice(-2000);
    await fs.writeFile(file, JSON.stringify({
      processedReviewKeys: keysArray
    }, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

export function resetReviewNotifCount(config) {
  // Called once per pipeline run. Without a config it resets every profile,
  // preserving the old behaviour for any caller that has not been updated.
  if (config) {
    const state = profileState(config);
    state.reviewNotifCount = 0;
    state.overflowCount = 0;
    return;
  }
  for (const state of profileStates.values()) {
    state.reviewNotifCount = 0;
    state.overflowCount = 0;
  }
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
      if (existing?.status === 'pending_apply') {
        // A Telegram-approved record can also appear in the fresh scraper
        // batch. Keep its source available for per-site budgets; an omitted
        // declaration here previously crashed the run with ReferenceError.
        const source = job.source_site || job.source || existing.source_site || existing.source || 'unknown';
        const errText = await response.text().catch(() => '');
        // A malformed upstream title/description must not suppress the review.
        // Retry without Markdown so the notification still reaches Telegram.
        if (response.status === 400 && cleanPayload.parse_mode) {
          const fallbackPayload = { ...cleanPayload };












































































































































      const isProvenWinner = local?.cluster?.tier === 'PROVEN_WINNER' ||
        local?.recommendation === 'auto_apply' ||
        local?.recommendation === 'instant_apply' ||





































































































































































  if (config?.telegramReviewNotificationsEnabled !== false) {
    if (config?.telegramReviewMode === 'digest') {
      await sendRunReviewDigest(config, runSummary.newReviewJobs);
    } else {
      await sendOverflowSummary(config);
    }















async function dispatchReviewNotification(jobPayload, score, config, runSummary = {}) {
  if (config?.telegramReviewNotificationsEnabled === false) return;
















































































    blocked: 0,
    held: 0,
    pending: 0,
    outcomes: []




















      return { failed: 1, outcome: 'failed', title: job.title, reason: 'No applicationUrl found in stored record.' };





      return { blocked: 1, outcome: 'blocked', title: job.title, reason: `Site ${source} is disabled.` };



      return { held: 1, outcome: 'held', title: job.title, reason: autoApplyLimitReason(autoApplyBudget, source) };













      return { blocked: 1, manualReview: 1, outcome: 'manual_review', title: job.title, reason: applyGate.reason };









    let queueOutcome = 'failed';
    if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
      queueOutcome = 'applied';






    } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
      queueOutcome = 'manual_review';














      const newStatus = effectiveRetryCount >= 3 ? 'failed' : 'pending_apply';
      queueOutcome = newStatus === 'failed' ? 'failed' : 'pending';










    res.outcome = queueOutcome;
    res.title = job.title;
    res.reason = applyResult.reason || '';
    return res;















      if (itemRes.pending) summary.pending += itemRes.pending;
      if (itemRes.outcome) {
        summary.outcomes.push({
          status: itemRes.outcome,
          title: itemRes.title || 'Untitled role',
          reason: itemRes.reason || ''
        });
      }







export async function validateLiveSubmitReadiness({ job, profile, existing = {}, config = {} }) {
  const freshness = checkJobFreshness(job, config);
  if (!freshness.fresh) {
    return { ready: false, reason: freshness.reason };
  }
  const applicationScore = bestStoredApplicationScore(existing);




  // Manual approval can override a score floor, but it must not bypass
  // location/remote eligibility. This keeps Telegram approvals from turning
  // an ineligible on-site role into a live submission accidentally.
  if (!isRemoteEligibleForLiveSubmit(job, config)) {



















































export function isRemoteEligibleForLiveSubmit(job = {}, config = {}) {
  if (config.liveSubmitRemoteOnly === false || config.remoteOnlyLiveSubmit === false) return true;
  const preferences = config.preferences || {};
  const remotePreference = config.remotePreference ?? preferences.remotePreference ?? 'remote_only';
  const allowHybrid = config.allowHybrid ?? preferences.allowHybrid ?? false;
  const willingToRelocate = config.willingToRelocate ?? preferences.willingToRelocate ?? false;
  const allowedLocations = config.allowedLocations ?? preferences.allowedLocations;

  if (remotePreference !== 'remote_only') {
    if (allowHybrid || willingToRelocate) return true;
    if (Array.isArray(allowedLocations) && allowedLocations.length > 0) {
      const loc = String(job.location || '').toLowerCase();
      if (allowedLocations.some((allowed) => loc.includes(allowed.toLowerCase()))) {
        return true;
      }
    }
  }

  const source = String(job.source_site || job.source || '').toLowerCase();
  const normalizedSource = source.replace(/[^a-z0-9]/g, '');
  if (['jobberman', 'myjobmag', 'hotnigerianjobs', 'indeed'].includes(normalizedSource) && remotePreference !== 'remote_only') {
























































































































































































































export function isTerminalApplicationResult(applyResult = {}) {
  if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) return true;
  return isDeterministicApplicationFailure(applyResult.reason)
    || /application (?:period|window) (?:has )?(?:closed|ended)/i.test(String(applyResult.reason || ''));
}

function checkJobFreshness(job = {}, config = {}) {
  const source = String(job.source_site || job.source || '').toLowerCase();
  const postedAt = job.postedAt || job.posted_at || job.raw?.postedAt || job.raw?.posted_at || job.raw?.publishedAt || job.raw?.createdAt || '';
  if (!postedAt) return { fresh: true, reason: '' };
  const timestamp = Date.parse(String(postedAt));
  if (!Number.isFinite(timestamp)) return { fresh: true, reason: '' };
  const configured = Number(config.sites?.[source]?.maxAgeDays);
  const maxAgeDays = Number.isFinite(configured) && configured > 0 ? configured : 30;
  if (Date.now() - timestamp > maxAgeDays * 24 * 60 * 60 * 1000) {
    return { fresh: false, reason: `Role is stale (${source || 'source'} posting is older than ${maxAgeDays} days).` };
  }
  return { fresh: true, reason: '' };
}

function filterStaleScrapedJobs(jobs = [], config = {}) {
  const fresh = [];
  let dropped = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const result = checkJobFreshness(job, config);
    if (result.fresh) fresh.push(job);
    else dropped += 1;
  }
  if (dropped > 0) {
    appendLog(`Dropped ${dropped} stale scraped role(s) before matching/Telegram review.`, config).catch(() => {});
  }
  return fresh;
}

export { isDeterministicApplicationFailure };











    const isProvenWinner = local?.cluster?.tier === 'PROVEN_WINNER' ||
      local?.recommendation === 'auto_apply' ||
      local?.recommendation === 'instant_apply' ||





























































































































