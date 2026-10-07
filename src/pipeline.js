import fs from 'node:fs/promises';
import path from 'node:path';
import { appendLog } from './logger.js';

async function withStartupTimeout(promise, ms, label = 'Operation') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
import {
  loadJobStore,
  getJobRecord,
  upsertJobRecord,
  getGlobalJobRecord,
  shouldSkipProcessed,
  shouldSkipGlobalProcessed
} from './jobStore.js';
import { syncJobApplicationsToSQLite } from './sqliteSync.js';

const recordJobStatus = upsertJobRecord;
import { runScrapers } from './scrapers/index.js';
import { localMatchJob } from './localMatcher.js';

function mergeScores(localScore = 0, geminiScore) {
  if (typeof geminiScore === 'number' && Number.isFinite(geminiScore)) {
    return Math.round((localScore * 0.4) + (geminiScore * 0.6));
  }
  return localScore;
}
import { verifyJobFit } from './aiMatcher.js';
import { optimizeApplication, saveOptimizerArtifacts } from './applicationOptimizer.js';
import { attemptApplication } from './automation.js';

export const ApplicationOutcome = {
  APPLIED_SUCCESSFULLY: 'applied_successfully',
  REQUIRES_MANUAL_REVIEW: 'requires_manual_review',
  APPLICATION_FAILED: 'application_failed',
  SKIPPED: 'skipped'
};

const attemptApplicationOnce = attemptApplication;
import {
  resetReviewNotifCount,
  sendRunReviewDigest,
  sendOverflowSummary
} from './telegramBot.js';
import { notifyRunSummary } from './notifications.js';
import { addReviewJob, removeReviewJob } from './reviewQueue.js';
import { loadOrBuildCandidateProfile } from './profileParser.js';
import { loadCvData } from './cvParser.js';

function buildResumeTextFromCvData(cvData = {}) {
  const parts = [
    cvData.name,
    cvData.summary,
    Array.isArray(cvData.skills) ? cvData.skills.join(', ') : '',
    Array.isArray(cvData.experience) ? cvData.experience.map((e) => `${e.title || ''} at ${e.company || ''}: ${e.summary || ''}`).join('\n') : ''
  ].filter(Boolean);
  return parts.join('\n\n');
}

async function readResumeText(resumePath) {
  if (!resumePath) return '';
  try {
    return await fs.readFile(resumePath, 'utf8');
  } catch {
    return '';
  }
}
import { isDeterministicApplicationFailure, maxRetries as defaultMaxRetries } from './applicationRetryPolicy.js';
import { PHASE_TIMEOUTS } from './config.js';

// Auto-apply budget tracker
export function createAutoApplyBudget(config = {}) {
  const maxPerRun = Number.isFinite(config.maxAutoApplyPerRun)
    ? config.maxAutoApplyPerRun
    : (Number.isFinite(config.maxDailyApplies) ? config.maxDailyApplies : 10);
  const siteLimits = {};
  for (const [site, sCfg] of Object.entries(config.sites || {})) {
    if (Number.isFinite(sCfg?.maxAutoApplyPerRun)) {
      siteLimits[site.toLowerCase()] = sCfg.maxAutoApplyPerRun;
    }
  }
  return {
    remaining: Math.max(0, maxPerRun),
    siteLimits,
    attempts: 0
  };
}

export function canAttemptAutoApply(budget, site) {
  if (!budget) return true;
  if (budget.remaining <= 0) return false;
  const siteKey = String(site || '').toLowerCase();
  if (budget.siteLimits && budget.siteLimits[siteKey] !== undefined && budget.siteLimits[siteKey] <= 0) {
    return false;
  }
  return true;
}

export function consumeAutoApplyAttempt(budget, site) {
  if (!budget) return;
  budget.remaining = Math.max(0, budget.remaining - 1);
  budget.attempts = (budget.attempts || 0) + 1;
  const siteKey = String(site || '').toLowerCase();
  if (budget.siteLimits && budget.siteLimits[siteKey] !== undefined) {
    budget.siteLimits[siteKey] = Math.max(0, budget.siteLimits[siteKey] - 1);
  }
}

export function autoApplyLimitReason(budget, site) {
  if (!budget) return 'No budget configured';
  if (budget.remaining <= 0) return 'Per-run auto-apply budget reached';
  const siteKey = String(site || '').toLowerCase();
  if (budget.siteLimits && budget.siteLimits[siteKey] <= 0) {
    return `Site auto-apply budget reached for ${siteKey}`;
  }
  return 'Auto-apply budget depleted';
}

export function isManualApplyApproval(record = {}) {
  return record.acceptedViaTelegram === true
    || record.acceptedViaDashboard === true
    || record.manualApproval === true;
}

export function getAiConsiderationFloor(config = {}) {
  if (Number.isFinite(config?.aiConsiderationFloor)) return config.aiConsiderationFloor;
  return 70;
}

export function isTerminalApplicationResult(applyResult = {}) {
  if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW || applyResult.outcome === 'requires_manual_review') {
    return true;
  }
  const reason = String(applyResult.reason || '');
  return isDeterministicApplicationFailure(reason)
    || /application (?:period|window) (?:has )?(?:closed|ended)/i.test(reason)
    || /Very complex form detected/i.test(reason)
    || /Job is no longer accepting applications/i.test(reason)
    || /Unknown ATS requires manual review/i.test(reason);
}

export function isNonEnglishJob(job = {}) {
  const title = String(job.title || '').trim();
  // Reject explicit bilingual markers or non-English titles
  const nonEnglishPatterns = [
    /\bbilingual\s+(?:spanish|french|german|portuguese|italian|mandarin|arabic|russian|japanese)\b/i,
    /\b(?:spanish|french|german|portuguese|italian|mandarin|arabic|russian|japanese)\s+bilingual\b/i,
    /\bdesenvolvedor\b/i,
    /\bdéveloppeur\b/i,
    /\bingeniero\b/i,
    /\bestagiário\b/i,
    /\bstagiaire\b/i,
    /\bassistente\b/i,
    /\bgerente\b/i,
    /\bvaga\b/i
  ];
  return nonEnglishPatterns.some((pattern) => pattern.test(title));
}

export function checkJobFreshness(job = {}, config = {}) {
  const source = String(job.source_site || job.source || '').toLowerCase();
  const postedAt = job.postedAt || job.posted_at || job.raw?.postedAt || job.raw?.posted_at;
  if (!postedAt) return { fresh: true, reason: '' };
  const timestamp = Date.parse(String(postedAt));
  if (!Number.isFinite(timestamp)) return { fresh: true, reason: '' };
  const configured = Number(config.sites?.[source]?.maxAgeDays);
  const maxAgeDays = Number.isFinite(configured) && configured > 0 ? configured : (config.maxJobAgeDays || 30);
  if (Date.now() - timestamp > maxAgeDays * 24 * 60 * 60 * 1000) {
    return { fresh: false, reason: `Role is stale (${source || 'source'} posting is older than ${maxAgeDays} days)` };
  }
  return { fresh: true, reason: '' };
}

export function filterStaleScrapedJobs(jobs = [], config = {}) {
  const fresh = [];
  let dropped = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const result = checkJobFreshness(job, config);
    if (result.fresh) fresh.push(job);
    else dropped += 1;
  }
  if (dropped > 0) {
    appendLog(`Dropped ${dropped} stale scraped role(s) before matching/Telegram`, config).catch(() => {});
  }
  return fresh;
}

export function isProfileAlignedRole(profile = {}, job = {}) {
  const profileName = String(profile.profileName || profile.name || '').toLowerCase();
  const title = String(job.title || '').toLowerCase();
  const desc = String(job.description || '').toLowerCase();
  const reqs = String(job.requirements || '').toLowerCase();
  const combined = `${title} ${desc} ${reqs}`;

  if (profileName.includes('tolu')) {
    // Tolu: Developer, WordPress, SEO, PHP, Laravel, Frontend, Full Stack
    const isTech = /wordpress|seo|web develop|frontend|front-end|full stack|fullstack|software|engineer|php|laravel|javascript|react|html|css|shopify/i.test(title);
    const isNonTech = /pest control|bookkeeper|executive assistant|travel coordinator|accounting|nurse|driver|cleaner/i.test(title);
    if (isNonTech) return false;
    if (isTech) return true;
    return /wordpress|technical seo|web development/i.test(combined);
  }

  if (profileName.includes('sister')) {
    // Sister: Customer Support, Virtual Assistant, Admin, CRM, Real Estate VA, Operations
    const isSupportOrAdmin = /customer support|customer success|client support|virtual assistant|executive assistant|administrative|operations|onboarding|booking|coordinator|receptionist|lead qualification|appointment setting|crm|hubspot|sales pipeline/i.test(title);
    const isHardTech = /software engineer|backend developer|frontend developer|python developer|react native|devops|full stack developer/i.test(title);
    if (isHardTech) return false;
    if (isSupportOrAdmin) return true;
    return /customer support|crm|administrative|calendar management|inbox management/i.test(combined);
  }

  return true;
}

export function isRemoteEligibleForLiveSubmit(job = {}, config = {}) {
  if (config.liveSubmitRemoteOnly === false || config.remoteOnlyLiveSubmit === false) return true;

  const source = String(job.source_site || job.source || '').toLowerCase();
  const trustedRemoteSources = ['bruntwork', 'himalayas', 'weworkremotely', 'workingnomads', 'realworkfromanywhere'];
  if (trustedRemoteSources.includes(source)) return true;

  const appUrl = String(job.applicationUrl || job.job_url || '').toLowerCase();
  if (trustedRemoteSources.some((ts) => appUrl.includes(ts))) return true;

  if (job.raw?.remote === true || job.remote === true) return true;

  const loc = String(job.location || '').toLowerCase();
  const title = String(job.title || '').toLowerCase();
  const desc = String(job.description || '').toLowerCase();
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\btelecommute\b|\banywhere\b/i.test(loc) ||
      /\bremote\b/i.test(title)) {
    return true;
  }

  const preferences = config.preferences || {};
  const remotePreference = config.remotePreference ?? preferences.remotePreference ?? 'remote_only';
  const allowHybrid = config.allowHybrid ?? preferences.allowHybrid ?? false;
  const willingToRelocate = config.willingToRelocate ?? preferences.willingToRelocate ?? false;
  const allowedLocations = config.allowedLocations ?? preferences.allowedLocations ?? [];

  if (remotePreference !== 'remote_only') {
    if (allowHybrid || willingToRelocate) return true;
    if (Array.isArray(allowedLocations) && allowedLocations.length > 0) {
      if (allowedLocations.some((allowed) => loc.includes(allowed.toLowerCase()))) {
        return true;
      }
    }
  }

  // If role is explicitly onsite in an unapproved city, block
  if (/\b(?:lagos|abuja|london|new york|berlin)\b/i.test(loc) && !/\bremote\b/i.test(loc) && !/\bremote\b/i.test(desc)) {
    return false;
  }

  return /\bremote\b/i.test(desc);
}

export function getReviewPromotion(config, job, local, gemini, optimizer, decision) {
  // Human review remains strict: do not automatically promote review roles without human sign-off
  return { promoted: false };
}

export async function validateLiveSubmitReadiness({ job = {}, profile = {}, existing = {}, config = {} }) {
  const freshness = checkJobFreshness(job, config);
  if (!freshness.fresh) {
    return { ready: false, reason: freshness.reason };
  }

  if (!isRemoteEligibleForLiveSubmit(job, config)) {
    return { ready: false, reason: 'Remote-only rule: Role is not verified remote-eligible.' };
  }

  const manuallyApproved = isManualApplyApproval(existing);
  const floor = Number.isFinite(config.applicationReviewScoreFloor) ? config.applicationReviewScoreFloor : 55;
  const effectiveScore = existing.score ?? existing.optimizer?.application_score ?? existing.local?.score ?? job.score ?? 0;

  if (existing.gemini?.should_apply === false) {
    if (!manuallyApproved) {
      return { ready: false, reason: 'AI verification previously rejected live submission.' };
    }
  }

  const candidateProfile = { ...profile, profileName: config.profileName || profile.profileName };
  if (!isProfileAlignedRole(candidateProfile, job)) {
    return { ready: false, reason: 'Current profile QA blocks live submit: Role title/duties are not aligned with candidate profile.' };
  }

  if (manuallyApproved) {
    // Explicit manual approval allows submission for 50+ or restaged roles
    if (effectiveScore < 50 && !String(existing.reason || '').toLowerCase().includes('restaged')) {
      return { ready: false, reason: `Job score ${effectiveScore} is below minimum manual submission threshold.` };
    }
    return { ready: true };
  }

  if (effectiveScore <= floor) {
    return { ready: false, reason: `Job score ${effectiveScore} is not above live-submit floor ${floor}.` };
  }

  return { ready: true };
}

export function getAutoApplyGate(config = {}, job = {}, local = {}, optimizer = {}, decision = 'apply') {
  if (config.autoApply === false || config.autoApplyEnabled === false) {
    return { enabled: false, reason: 'Auto-apply is disabled in configuration.' };
  }

  const source = String(job.source_site || job.source || '').toLowerCase();
  if (config.sites?.[source]?.autoApplyEnabled === false) {
    return { enabled: false, reason: 'Disabled in config/sites.json' };
  }

  const GATEWAY_SOURCES = ['remoteok', 'remotejobsorg', 'indeed', 'linkedin', 'jobberman', 'myjobmag', 'hotnigerianjobs', 'ngcareers'];
  if (GATEWAY_SOURCES.includes(source) && !config.allowGatewayAutoSubmit) {
    return { enabled: false, reason: 'ALLOW_GATEWAY_AUTO_SUBMIT is disabled for gateway sources' };
  }

  const isHardExcluded = local?.cluster?.tier === 'HARD_EXCLUSION' ||
    (optimizer?.risk_flags || []).some((f) => f.severity === 'high');
  if (isHardExcluded) {
    return { enabled: false, reason: 'Hard exclusion or high risk flag blocked auto-apply.' };
  }

  if (local?.score !== undefined || optimizer?.application_score !== undefined || job.score !== undefined) {
    const score = optimizer?.application_score ?? local?.score ?? job.score ?? 0;
    const threshold = Number.isFinite(config.autoApplyScoreThreshold) ? config.autoApplyScoreThreshold : 85;

    if (decision !== 'apply' || score < threshold) {
      return { enabled: false, reason: `Score ${score} below auto-apply threshold ${threshold}; requires human review.` };
    }

    const tier = local?.cluster?.tier;
    if (tier === 'SELECTIVE_FIT' && score < 85) {
      return { enabled: false, reason: 'Selective fit requires 85+ score or human review.' };
    }
  }

  return { enabled: true, reason: 'Meets auto-apply criteria.' };
}


export async function flushPendingApplyQueue(config, autoApplyBudget = createAutoApplyBudget(config)) {
  const summary = {
    queued: 0,
    attempts: 0,
    applied: 0,
    manualReview: 0,
    failed: 0,
    blocked: 0,
    held: 0,
    pending: 0
  };

  const store = await loadJobStore(config);
  const pending = (store.jobs || []).filter((j) => j.status === 'pending_apply');
  summary.queued = pending.length;
  if (pending.length === 0) return summary;

  let profile = null;
  const maxRetries = config.maxRetries || defaultMaxRetries || 3;
  await appendLog(`Flushing ${pending.length} Telegram-approved job(s)`, config);

  for (const record of pending) {
    const job = {
      ...record,
      applicationUrl: record.applicationUrl || record.job_url || ''
    };
    const manuallyApproved = isManualApplyApproval(record);
    const source = job.source_site || job.source || 'unknown';

    if (!job.applicationUrl) {
      await appendLog(`SKIPPED (no applicationUrl): ${job.title || 'Untitled'}`, config);
      await upsertJobRecord(config, job, 'failed', { reason: 'No applicationUrl found in stored record.' });
      summary.failed += 1;
      continue;
    }

    if (!manuallyApproved && config.enabledSites && config.enabledSites.length > 0 && !config.enabledSites.includes(source)) {
      await appendLog(`Pending apply skipped (disabled site ${source}): ${job.title}`, config);
      await upsertJobRecord(config, job, 'ignored', { reason: `Site ${source} is disabled.` });
      summary.blocked += 1;
      continue;
    }

    if (!manuallyApproved && !canAttemptAutoApply(autoApplyBudget, source)) {
      await appendLog(`Pending apply held: ${job.title} - ${autoApplyLimitReason(autoApplyBudget, source)}`, config);
      summary.held += 1;
      continue;
    }

    profile ||= config.candidateProfile || (config.profileDir ? await loadOrBuildCandidateProfile(config).catch(() => null) : null) || { profileName: config.profileName };
    const applyGate = await validateLiveSubmitReadiness({ job, profile, existing: record, config });
    if (!applyGate.ready) {
      await appendLog(`Pending apply blocked by final gate: ${job.title} - ${applyGate.reason}`, config);
      await upsertJobRecord(config, job, 'manual_review', {
        score: job.score || 0,
        decision: 'review',
        acceptedViaTelegram: record.acceptedViaTelegram === true,
        acceptedViaDashboard: record.acceptedViaDashboard === true,
        reason: applyGate.reason,
        terminal: true
      });
      summary.blocked += 1;
      continue;
    }

    await appendLog(`Telegram-accepted job: ${job.title} — applying now (${job.applicationUrl})`, config);
    const appPackage = {
      coverLetterText: record.cover_letter || record.coverLetterText || '',
      applicationAnswers: record.application_answers || record.improved_answers || record.applicationAnswers || {}
    };

    consumeAutoApplyAttempt(autoApplyBudget, source);
    summary.attempts += 1;

    const applyResult = await attemptApplicationOnce(job, appPackage, config);
    if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY || applyResult.outcome === 'applied_successfully') {
      summary.applied += 1;
      await upsertJobRecord(config, job, 'applied', {
        score: job.score || 0,
        decision: 'apply',
        acceptedViaTelegram: true,
        appliedAt: new Date().toISOString()
      });
      await appendLog(`APPLIED: ${job.title} (Telegram-approved)`, config);
    } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW || applyResult.outcome === 'requires_manual_review') {
      summary.manualReview += 1;
      await upsertJobRecord(config, job, 'manual_review', {
        score: job.score || 0,
        decision: 'review',
        acceptedViaTelegram: true,
        reason: applyResult.reason,
        retryCount: maxRetries,
        terminal: true
      });
      await appendLog(`MANUAL_REVIEW: ${job.title} — ${applyResult.reason} (automatic retries stopped)`, config);
    } else {
      const retryCount = (record.retryCount || 0) + 1;
      const terminal = isTerminalApplicationResult(applyResult);
      const effectiveRetryCount = terminal ? maxRetries : retryCount;
      const newStatus = effectiveRetryCount >= maxRetries ? 'manual_review' : 'pending_apply';

      if (newStatus === 'manual_review') {
        summary.manualReview += 1;
      } else {
        summary.pending += 1;
      }

      await upsertJobRecord(config, job, newStatus, {
        score: job.score || 0,
        decision: newStatus === 'manual_review' ? 'review' : 'apply',
        reason: applyResult.reason,
        retryCount: effectiveRetryCount,
        terminal
      });
      await appendLog(`Application result for ${job.title}: ${newStatus} (${applyResult.reason})`, config);
    }
  }

  return summary;
}

export async function runJobHunt(config, options = {}) {
  resetReviewNotifCount(config);
  await appendLog('Run started', config);
  const autoApplyBudget = createAutoApplyBudget(config);

  // Phase 1: SCRAPE
  const profile = await loadOrBuildCandidateProfile(config);
  config.candidateProfile = profile;
  const cvData = await loadCvData(config).catch((err) => {
    console.warn(`[pipeline] CV parse skipped: ${err.message}`);
    return null;
  });
  if (cvData) {
    config.cvData = cvData;
    await withStartupTimeout(
      appendLog(`CV data loaded for ${config.profileName}: ${cvData.name || 'unknown'}`, config),
      5000,
      'CV log append'
    ).catch(() => {});
  }

  let resumeText = cvData ? buildResumeTextFromCvData(cvData) : '';
  if (!resumeText) {
    resumeText = await withStartupTimeout(readResumeText(config.resumePath), 15000, 'Resume parsing').catch(() => '');
  }

  const existingJobStore = await loadJobStore(config).catch(() => ({ jobs: [] }));
  config.knownJobUrls = new Set(
    (existingJobStore.jobs || []).flatMap((j) => {
      const u1 = String(j.job_url || '').trim();
      const u2 = String(j.applicationUrl || '').trim();
      return [u1, u2].filter(Boolean);
    })
  );

  const scrapeResult = await withStartupTimeout(
    runScrapers(config),
    PHASE_TIMEOUTS?.scrape || 300000,
    'Phase 1: Scrape'
  ).catch((error) => {
    console.error(`[pipeline] Scrape error: ${error.message}`);
    return { jobs: [], siteResults: [] };
  });

  // Phase 2: FILTER
  const jobs = filterStaleScrapedJobs(scrapeResult.jobs, config);
  await appendLog(`Scraped ${jobs.length} fresh job(s)`, config);

  const runSummary = {
    ...scrapeResult,
    jobsIgnored: 0,
    jobsQueuedForReview: 0,
    jobsAutoApplied: 0,
    jobsAutoApplyAttempts: 0,
    processingErrors: 0,
    jobsDeduped: 0,
    newReviewJobs: []
  };

  const results = [];
  const jobsToScore = [];

  for (const job of jobs) {
    const existing = await getJobRecord(config, job);
    const globalExisting = await getGlobalJobRecord(config, job);
    if (shouldSkipGlobalProcessed(globalExisting, config) && !options.reprocess) {
      if (!existing || existing.status !== 'duplicate') {
        await upsertJobRecord(config, job, 'duplicate', { decision: 'duplicate', skippedBecause: 'Global dupe' });
      }
      runSummary.jobsDeduped += 1;
      continue;
    }

    const canReprocess = options.reprocessNonApplied === true && existing?.status !== 'applied';
    if (shouldSkipProcessed(existing) && !options.reprocess && !canReprocess) {
      runSummary.jobsDeduped += 1;
      continue;
    }

    if (isNonEnglishJob(job)) {
      runSummary.jobsIgnored += 1;
      await recordJobStatus(config, job, 'ignored', { decision: 'ignore', reason: 'Non-English' });
      continue;
    }

    jobsToScore.push({ job, existing, globalExisting });
  }

  // Phase 3: SCORE
  const scoredJobs = [];
  for (const { job, existing } of jobsToScore) {
    try {
      const local = await withStartupTimeout(
        localMatchJob(job, profile, config),
        PHASE_TIMEOUTS?.score || 60000,
        'Score'
      ).catch(() => ({ score: 0 }));

      const aiConsiderationFloor = getAiConsiderationFloor(config);
      if (local.score < aiConsiderationFloor) {
        runSummary.jobsIgnored += 1;
        await recordJobStatus(config, job, 'ignored', { score: local.score, decision: 'ignore', local });
        continue;
      }

      const gemini = await verifyJobFit(job, profile, local, config);
      const mergedScore = mergeScores(local.score, gemini?.adjusted_score);
      const optimizer = optimizeApplication({
        job,
        candidateProfile: profile,
        resumeText,
        localAnalysis: local,
        aiAnalysis: gemini,
        config
      });
      await saveOptimizerArtifacts(config, job, optimizer);
      scoredJobs.push({ job, local, gemini, optimizer, mergedScore, existing });
    } catch {
      runSummary.processingErrors += 1;
    }
  }

  // Phase 4: TRIAGE & Phase 6: APPLY
  const autoApplyThreshold = Number.isFinite(config.autoApplyScoreThreshold) ? config.autoApplyScoreThreshold : 75;

  for (const { job, local, gemini, optimizer, mergedScore } of scoredJobs) {
    const effectiveScore = optimizer.application_score ?? local.score ?? 0;
    const isHardExcluded = local?.cluster?.tier === 'HARD_EXCLUSION' ||
      (optimizer.risk_flags || []).some((f) => f.severity === 'high');
    const isProvenWinner = local?.cluster?.tier === 'PROVEN_WINNER' ||
      local?.recommendation === 'auto_apply' ||
      (local?.cluster?.tier === 'SELECTIVE_FIT' && effectiveScore >= 85);

    let decision = 'ignore';
    if (isHardExcluded) {
      decision = 'ignore';
    } else if (effectiveScore >= autoApplyThreshold && isProvenWinner) {
      decision = 'apply';
    } else if (effectiveScore >= (config.minReviewScore || 50)) {
      decision = 'review';
    }

    if (decision === 'apply') {
      const autoApplyGate = getAutoApplyGate(config, job, local, optimizer, decision);
      if (!autoApplyGate.enabled || !canAttemptAutoApply(autoApplyBudget, job.source || job.source_site || 'unknown')) {
        runSummary.jobsQueuedForReview += 1;
        await addReviewJob(job, { local, gemini, optimizer, score: effectiveScore }, autoApplyGate.reason || 'Limit reached', config);
        await recordJobStatus(config, job, 'reviewed', { score: effectiveScore, decision: 'review' });
      } else {
        consumeAutoApplyAttempt(autoApplyBudget, job.source || job.source_site || 'unknown');
        runSummary.jobsAutoApplyAttempts += 1;
        const applyResult = await withStartupTimeout(
          attemptApplicationOnce(job, optimizer, config),
          PHASE_TIMEOUTS?.apply || 120000,
          'Phase 6: Apply'
        ).catch((e) => ({ outcome: 'failed', reason: e.message }));

        if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY || applyResult.outcome === 'applied_successfully') {
          runSummary.jobsAutoApplied += 1;
          await removeReviewJob(job, config);
          await recordJobStatus(config, job, 'applied', { score: effectiveScore, decision, appliedAt: new Date().toISOString() });
        } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW || applyResult.outcome === 'requires_manual_review') {
          runSummary.jobsQueuedForReview += 1;
          await recordJobStatus(config, job, 'manual_review', { score: effectiveScore, decision: 'review', reason: applyResult.reason, terminal: true });
        } else {
          await recordJobStatus(config, job, 'failed', { score: effectiveScore, decision, reason: applyResult.reason });
        }
      }
    } else if (decision === 'review') {
      runSummary.jobsQueuedForReview += 1;
      await addReviewJob(job, { local, gemini, optimizer, score: effectiveScore }, 'Needs review', config);
      await recordJobStatus(config, job, 'reviewed', { score: effectiveScore, decision });
    } else {
      runSummary.jobsIgnored += 1;
      await recordJobStatus(config, job, 'ignored', { score: effectiveScore, decision });
    }
  }

  // Phase 5: REVIEW_FLUSH
  const pendingRun = await withStartupTimeout(
    flushPendingApplyQueue(config, autoApplyBudget),
    PHASE_TIMEOUTS?.pendingFlush || 600000,
    'Phase 5: Review Flush'
  ).catch(() => ({ manualReview: 0, blocked: 0, applied: 0, attempts: 0, failed: 0 }));

  runSummary.jobsQueuedForReview += (pendingRun.manualReview || 0) + (pendingRun.blocked || 0);
  runSummary.jobsAutoApplied += (pendingRun.applied || 0);
  runSummary.jobsAutoApplyAttempts += (pendingRun.attempts || 0);
  runSummary.processingErrors += (pendingRun.failed || 0);

  // Phase 7: PERSIST
  if (config?.telegramReviewMode === 'digest') {
    await sendRunReviewDigest(config, runSummary.newReviewJobs);
  } else {
    await sendOverflowSummary(config);
  }

  await notifyRunSummary(results, config, runSummary);
  const store = await loadJobStore(config);
  if (store.jobs && store.jobs.length > 0) {
    await syncJobApplicationsToSQLite(store.jobs, config);
  }

  await appendLog('Run finished', config);
  results.runSummary = runSummary;
  return results;
}

export { isDeterministicApplicationFailure };
