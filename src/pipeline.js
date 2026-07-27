import { appendLog } from './logger.js';
import { localMatchJob } from './localMatcher.js';
import { loadOrBuildCandidateProfile, readResumeText, updateProfileLearning } from './profileParser.js';
import { verifyJobFit } from './aiMatcher.js';
import { attemptApplication } from './automation.js';
import { ApplicationOutcome } from './applicationStateManager.js';
import { addReviewJob, removeReviewJob } from './reviewQueue.js';
import { printDashboard } from './dashboard.js';
import {
  getGlobalJobRecord,
  getJobRecord,
  loadJobStore,
  shouldSkipGlobalProcessed,
  shouldSkipProcessed,
  upsertGlobalJobRecord,
  upsertJobRecord
} from './jobStore.js';
import { notifyRunSummary } from './notifications.js';
import { loadCvData } from './cvParser.js';
import { sendReviewNotification, resetReviewNotifCount, sendOverflowSummary } from './telegramBot.js';
import { withRetry } from './retry.js';
import { runScrapers } from './scrapers/index.js';
import { optimizeApplication, saveOptimizerArtifacts } from './applicationOptimizer.js';
import { hasAvailableAiProvider } from './aiRouter.js';
import { syncJobApplicationsBatch } from './jobApplicationSync.js';
import { syncJobApplicationsToSQLite } from './sqliteSync.js';
import { pullDashboardApprovals } from './dashboardSync.js';

export async function runJobHunt(config, options = {}) {
  resetReviewNotifCount();
  await appendLog('Run started', config);
  const autoApplyBudget = createAutoApplyBudget(config);
  const profile = await loadOrBuildCandidateProfile(config);
  config.candidateProfile = profile;
  const cvData = await loadCvData(config).catch((err) => { console.warn(`[pipeline] CV parse skipped: ${err.message}`); return null; });
  if (cvData) {
    config.cvData = cvData;
    await appendLog(`CV data loaded for ${config.profileName}: ${cvData.name || 'unknown'} | phone: ${cvData.phone ? '✓' : '✗'} | linkedin: ${cvData.linkedin ? '✓' : '✗'}`, config);
  }
  const resumeText = await readResumeText(config.resumePath);
  if (!resumeText.trim() && config.autoApply && !config.resumePlaceholder) {
    const message = `Resume text missing for ${config.profileName}. Check resumePath: ${config.resumePath}. Skipping this profile run to avoid low-quality scoring or applications.`;
    await appendLog(message, config);
    console.warn(`[pipeline] ${message}`);
    return [];
  }
  await pullDashboardApprovals(config);
  const pendingRun = await flushPendingApplyQueue(config, autoApplyBudget);
  const scrapeResult = await withRetry(() => runScrapers(config), { retries: 1, delayMs: 5000 });
  const jobs = scrapeResult.jobs;
  const runSummary = {
    ...scrapeResult,
    jobsIgnored: 0,
    jobsQueuedForReview: pendingRun.manualReview + pendingRun.blocked,
    jobsAutoApplied: pendingRun.applied,
    jobsAutoApplyAttempts: pendingRun.attempts,
    processingErrors: pendingRun.failed,
    jobsDeduped: 0
  };
  await appendLog(`Scraped ${jobs.length} job(s)`, config);

  const results = [];

  for (const job of jobs) {
    try {
      const globalExisting = await getGlobalJobRecord(config, job);
      if (shouldSkipGlobalProcessed(globalExisting, config) && !options.reprocess) {
        const owner = globalExisting.applied_by_profile || 'another profile';
        const row = rowFor(job, globalExisting.score || 0, 'duplicate', 'duplicate', {
          reasons: [`Already processed by ${owner} (${globalExisting.status}).`]
        });
        await upsertJobRecord(config, job, 'duplicate', {
          score: globalExisting.score || 0,
          decision: 'duplicate',
          skippedBecause: `Already processed by ${owner}`,
          globalStatus: globalExisting.status
        });
        results.push(row);
        runSummary.jobsDeduped += 1;
        await appendLog(`Global dedupe skipped ${job.title}; owner=${owner}, status=${globalExisting.status}`, config);
        continue;
      }

      const existing = await getJobRecord(config, job);

      // Handle jobs accepted via Telegram — apply immediately
      if (existing?.status === 'pending_apply') {
        const applyGate = await validateLiveSubmitReadiness({ job, profile, existing, config });
        if (!applyGate.ready) {
          runSummary.jobsQueuedForReview += 1;
          results.push(rowFor(job, existing.score || 0, 'review', 'pending', {
            reasons: [applyGate.reason]
          }));
          await upsertJobRecord(config, job, 'reviewed', {
            score: existing.score || 0,
            decision: 'review',
            acceptedViaTelegram: existing.acceptedViaTelegram === true,
            skippedBecause: applyGate.reason
          });
          await appendLog(`Pending apply blocked by final gate: ${job.title} - ${applyGate.reason}`, config);
          continue;
        }
        if (!canAttemptAutoApply(autoApplyBudget)) {
          const limitReason = autoApplyLimitReason(autoApplyBudget);
          runSummary.jobsQueuedForReview += 1;
          results.push(rowFor(job, existing.score || 0, 'apply', 'pending', {
            reasons: [limitReason]
          }));
          await appendLog(`Pending apply held: ${job.title} - ${limitReason}`, config);
          continue;
        }
        await appendLog(`Telegram-accepted job: ${job.title} — applying now`, config);
        // Ensure applicationUrl is set from the live scraped job (most reliable)
        const jobWithUrl = { ...job, applicationUrl: job.applicationUrl || existing.job_url || existing.applicationUrl || '' };
        const appPackage = {
          coverLetterText: existing.cover_letter || existing.coverLetterText || '',
          applicationAnswers: existing.application_answers || existing.improved_answers || existing.applicationAnswers || {}
        };
        consumeAutoApplyAttempt(autoApplyBudget);
        runSummary.jobsAutoApplyAttempts += 1;
        const applyResult = await withRetry(() => attemptApplication(jobWithUrl, appPackage, config), {
          retries: 2, delayMs: 5000, backoff: 'exponential'
        });
        const row = rowFor(jobWithUrl, existing.score || 0, 'apply', statusForApplicationResult(applyResult));
        if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
          runSummary.jobsAutoApplied += 1;
          await recordJobStatus(config, jobWithUrl, 'applied', {
            score: existing.score || 0, decision: 'apply',
            acceptedViaTelegram: true, appliedAt: new Date().toISOString()
          });
        } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
          runSummary.jobsQueuedForReview += 1;
          await recordJobStatus(config, jobWithUrl, 'manual_review', {
            score: existing.score || 0,
            decision: 'review',
            acceptedViaTelegram: true,
            reason: applyResult.reason,
            retryCount: 3,
            terminal: true
          });
        } else {
          const terminal = isTerminalApplicationResult(applyResult);
          await recordJobStatus(config, jobWithUrl, terminal ? 'failed' : 'pending_apply', {
            score: existing.score || 0, decision: 'apply',
            reason: applyResult.reason,
            retryCount: terminal ? 3 : (existing.retryCount || 0) + 1,
            terminal
          });
        }
        results.push(row);
        continue;
      }

      if (shouldSkipProcessed(existing) && !options.reprocess) {
        const dedupedRow = rowFor(job, existing.score || 0, existing.decision || existing.status, existing.status);
        dedupedRow.deduped = true;
        results.push(dedupedRow);
        await upsertGlobalJobRecord(config, job, existing.status, {
          score: existing.score || 0,
          decision: existing.decision || existing.status
        });
        runSummary.jobsDeduped += 1;
        await appendLog(`Deduped previously processed job: ${job.title} (${existing.status})`, config);
        continue;
      }

      if (isNonEnglishJob(job)) {
        await appendLog(`Skipped non-English job: ${job.title}`, config);
        runSummary.jobsIgnored += 1;
        await recordJobStatus(config, job, 'ignored', { score: 0, decision: 'ignore', reason: 'Non-English job posting' });
        results.push(rowFor(job, 0, 'ignore', 'skipped', { reasons: ['Non-English job posting'] }));
        continue;
      }

      const local = await localMatchJob(job, profile, config);
      await appendLog(`Local screen: ${job.title} scored ${local.score} (${local.recommendation})`, config);

      const aiConsiderationFloor = getAiConsiderationFloor(config);
      if (local.score < aiConsiderationFloor) {
        const row = rowFor(job, local.score, 'ignore', 'skipped', local);
        runSummary.jobsIgnored += 1;
        await recordJobStatus(config, job, 'ignored', {
          score: local.score,
          decision: 'ignore',
          local
        });
        await updateProfileLearning(config, { job, status: 'ignored', score: local.score });
        results.push(row);
        continue;
      }

      const gemini = await verifyJobFit(job, profile, local, config);
      const mergedScore = mergeScores(local.score, gemini.adjusted_score);
      const optimizer = optimizeApplication({
        job,
        candidateProfile: profile,
        resumeText,
        localAnalysis: local,
        aiAnalysis: gemini,
        config
      });

      // AI-Powered Resume & Cover Letter Tailoring
      if (optimizer.application_score > 85 && hasAvailableAiProvider(config)) {
        try {
          const { tailorResumeAndCoverLetter } = await import('./resumeTailor.js');
          const jobContext = `${job.description || ''} ${job.requirements || ''}`;
          const tailored = await tailorResumeAndCoverLetter(
            job.id || String(Date.now()),
            job.title,
            jobContext,
            resumeText,
            config.profileDir,
            config
          );
          if (tailored) {
            optimizer.optimized_cover_letter = tailored.coverLetterText;
            optimizer.tailored_resume_path = tailored.resumePath;
            await appendLog(`Successfully tailored Resume & Cover Letter for high-scoring job: ${job.title}`, config);
          }
        } catch (err) {
          console.warn(`[pipeline] Failed to tailor resume: ${err.message}`);
        }
      }

      await saveOptimizerArtifacts(config, job, optimizer);

      let decision = optimizer.recommendation;
      const promotion = getReviewPromotion(config, job, local, gemini, optimizer, decision);
      if (promotion.promoted) {
        decision = 'apply';
        optimizer.recommendation = 'apply';
      }
      const analysis = buildAnalysis(local, gemini, optimizer, mergedScore, decision);
      const row = rowFor(job, optimizer.application_score, decision, 'skipped', analysis);

      if (decision === 'apply') {
        const autoApplyGate = getAutoApplyGate(config, job);
        if (!autoApplyGate.enabled) {
          row.status = 'pending';
          runSummary.jobsQueuedForReview += 1;
          await addReviewJob(job, analysis, autoApplyGate.reason, config);
          await recordJobStatus(config, job, 'reviewed', {
            score: optimizer.application_score,
            decision,
            local,
            gemini,
            optimizer
          });
          await appendLog(`Queued for review: ${job.title} (${optimizer.application_score}) - ${autoApplyGate.reason}`, config);
          await sendReviewNotification({ ...job, reviewReason: autoApplyGate.reason }, optimizer.application_score, config);
        } else if (!canAttemptAutoApply(autoApplyBudget)) {
          const limitReason = autoApplyLimitReason(autoApplyBudget);
          row.status = 'pending';
          runSummary.jobsQueuedForReview += 1;
          await addReviewJob(job, analysis, limitReason, config);
          await recordJobStatus(config, job, 'reviewed', {
            score: optimizer.application_score,
            decision,
            local,
            gemini,
            optimizer
          });
          await appendLog(`Queued for review: ${job.title} (${optimizer.application_score}) - ${limitReason}`, config);
          await sendReviewNotification({ ...job, reviewReason: limitReason }, optimizer.application_score, config);
        } else {
          const attemptNumber = consumeAutoApplyAttempt(autoApplyBudget);
          runSummary.jobsAutoApplyAttempts += 1;
          const limitLabel = Number.isFinite(autoApplyBudget.limit) ? String(autoApplyBudget.limit) : 'unlimited';
          await appendLog(`Auto-apply attempt ${attemptNumber}/${limitLabel}: ${job.title}`, config);
          const applyResult = await withRetry(() => attemptApplication(job, optimizer, config), {
            retries: 2,
            delayMs: 5000,
            backoff: 'exponential'
          });
          row.status = statusForApplicationResult(applyResult);
          if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
            runSummary.jobsAutoApplied += 1;
            await removeReviewJob(job, config);
            await recordJobStatus(config, job, 'applied', {
              score: optimizer.application_score,
              decision,
              local,
              gemini,
              optimizer,
              application: applyResult,
              appliedAt: new Date().toISOString()
            });
            await updateProfileLearning(config, { job, status: 'applied', score: optimizer.application_score });
          } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
            runSummary.jobsQueuedForReview += 1;
            await addReviewJob(job, analysis, applyResult.reason, config, applyResult);
            await recordJobStatus(config, job, 'manual_review', {
              score: optimizer.application_score,
              decision,
              reason: applyResult.reason,
              local,
              gemini,
              optimizer,
              application: applyResult
            });
            // A live attempt can fail safely after the initial review message was
            // sent. Notify again so the user can act on the manual-review reason.
            await sendReviewNotification({
              ...job,
              reviewReason: applyResult.reason || 'Application requires manual review.'
            }, optimizer.application_score, config);
            await appendLog(`Queued for manual review: ${job.title} - ${applyResult.reason}`, config);
          } else {
            await recordJobStatus(config, job, 'failed', {
              score: optimizer.application_score,
              decision,
              reason: applyResult.reason,
              local,
              gemini,
              optimizer,
              application: applyResult,
              retryCount: (existing?.retryCount || 0) + 1
            });
          }
          await appendLog(`${row.status.toUpperCase()}: ${job.title} - ${applyResult.reason}`, config);
        }
      } else if (decision === 'review') {
        const reviewReason = promotion.reason || reviewReasonForOptimizer(optimizer);
        row.status = 'pending';
        runSummary.jobsQueuedForReview += 1;
        await addReviewJob(job, analysis, reviewReason, config);
        await recordJobStatus(config, job, 'reviewed', {
          score: optimizer.application_score,
          decision,
          local,
          gemini,
          optimizer
        });
        await sendReviewNotification({ ...job, reviewReason }, optimizer.application_score, config);
        await updateProfileLearning(config, { job, status: 'reviewed', score: optimizer.application_score });
        await appendLog(`Queued for review: ${job.title} (${optimizer.application_score}) - ${reviewReason}`, config);
      } else {
        runSummary.jobsIgnored += 1;
        await recordJobStatus(config, job, 'ignored', {
          score: optimizer.application_score,
          decision,
          local,
          gemini,
          optimizer
        });
        await updateProfileLearning(config, { job, status: 'ignored', score: optimizer.application_score });
        await appendLog(`Skipped quality-control job: ${job.title} (${optimizer.application_score})`, config);
      }

      results.push(row);
    } catch (error) {
      runSummary.processingErrors += 1;
      await appendLog(`Job processing failed: ${job.title} - ${error.stack || error.message}`, config);
      await recordJobStatus(config, job, 'failed', { reason: error.message });
      results.push(rowFor(job, 0, 'failed', 'failed'));
    }
  }

  await sendOverflowSummary(config);
  await notifyRunSummary(results, config, runSummary);

  // Sync all processed jobs to SQLite for tracking
  const store = await loadJobStore(config);
    if (store.jobs && store.jobs.length > 0) {
      await syncJobApplicationsToSQLite(store.jobs, config);
      await syncJobApplicationsBatch(store.jobs, config);
    }

  await appendLog('Run finished', config);
  results.runSummary = runSummary;
  return results;
}

function createAutoApplyBudget(config = {}) {
  const limit = Number(config.maxAutoApplyPerRun);
  return {
    limit: Number.isFinite(limit) && limit >= 0 ? limit : Infinity,
    attempts: 0
  };
}

function canAttemptAutoApply(budget) {
  if (!budget) return true;
  return budget.attempts < budget.limit;
}

function consumeAutoApplyAttempt(budget) {
  if (!budget) return 1;
  budget.attempts += 1;
  return budget.attempts;
}

function autoApplyLimitReason(budget) {
  if (budget?.limit === 0) return 'Auto-apply is disabled for this run. Awaiting user approval.';
  return 'Auto-apply run limit reached. Awaiting user approval.';
}

export async function flushPendingApplyQueue(config, autoApplyBudget = createAutoApplyBudget(config)) {
  // Auto-apply queue flushing re-enabled after successful BruntWork pipeline test (2026-05-30)

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
  await appendLog(`Flushing ${pending.length} Telegram-approved job(s)`, config);
  for (const record of pending) {
    if (!canAttemptAutoApply(autoApplyBudget)) {
      await appendLog(`Pending apply held: ${record.title} - ${autoApplyLimitReason(autoApplyBudget)}`, config);
      summary.held += 1;
      break;
    }
    // Normalise: jobStore saves applicationUrl as job_url — resolve both
    const job = {
      ...record,
      applicationUrl: record.applicationUrl || record.job_url || ''
    };
    if (!job.applicationUrl) {
      await appendLog(`SKIPPED (no applicationUrl): ${job.title}`, config);
      await upsertJobRecord(config, job, 'failed', { reason: 'No applicationUrl found in stored record.' });
      summary.failed += 1;
      continue;
    }
    profile ||= await loadOrBuildCandidateProfile(config);
    const applyGate = await validateLiveSubmitReadiness({ job, profile, existing: record, config });
    if (!applyGate.ready) {
      await appendLog(`Pending apply blocked by final gate: ${job.title} - ${applyGate.reason}`, config);
      await upsertJobRecord(config, job, 'reviewed', {
        score: job.score || 0,
        decision: 'review',
        acceptedViaTelegram: record.acceptedViaTelegram === true,
        skippedBecause: applyGate.reason
      });
      summary.blocked += 1;
      continue;
    }
    await appendLog(`Telegram-accepted job: ${job.title} — applying now (${job.applicationUrl})`, config);
    // Second arg is the cover-letter/optimizer package — pull from stored record fields
    const appPackage = {
      coverLetterText: record.cover_letter || record.coverLetterText || '',
      applicationAnswers: record.application_answers || record.improved_answers || record.applicationAnswers || {}
    };
    consumeAutoApplyAttempt(autoApplyBudget);
    summary.attempts += 1;
    const applyResult = await withRetry(() => attemptApplication(job, appPackage, config), {
      retries: 2, delayMs: 5000, backoff: 'exponential'
    });
    if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
      summary.applied += 1;
      await upsertJobRecord(config, job, 'applied', {
        score: job.score || 0, decision: 'apply',
        acceptedViaTelegram: true, appliedAt: new Date().toISOString()
      });
      await appendLog(`APPLIED: ${job.title} (Telegram-approved)`, config);
    } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
      summary.manualReview += 1;
      await upsertJobRecord(config, job, 'manual_review', {
        score: job.score || 0,
        decision: 'review',
        acceptedViaTelegram: true,
        reason: applyResult.reason,
        retryCount: 3,
        terminal: true
      });
      await appendLog(`MANUAL_REVIEW: ${job.title} — ${applyResult.reason} (automatic retries stopped)`, config);
    } else {
      const retryCount = (record.retryCount || 0) + 1;
      const terminal = isTerminalApplicationResult(applyResult);
      const effectiveRetryCount = terminal ? 3 : retryCount;
      const newStatus = effectiveRetryCount >= 3 ? 'failed' : 'pending_apply';
      if (newStatus === 'failed') summary.failed += 1;
      else summary.pending += 1;
      await upsertJobRecord(config, job, newStatus, {
        score: job.score || 0, decision: 'apply',
        reason: applyResult.reason,
        retryCount: effectiveRetryCount,
        terminal
      });
      await appendLog(`${newStatus.toUpperCase()}: ${job.title} — ${applyResult.reason} (attempt ${effectiveRetryCount}/3)`, config);
    }
  }
  return summary;
}

export async function validateLiveSubmitReadiness({ job, profile, existing = {}, config = {} }) {
  const applicationScore = bestStoredApplicationScore(existing);
  const liveSubmitFloor = Number.parseInt(config.applicationReviewScoreFloor, 10);
  const effectiveLiveSubmitFloor = Number.isFinite(liveSubmitFloor) ? liveSubmitFloor : 55;

  if (!isRemoteEligibleForLiveSubmit(job, config)) {
    return {
      ready: false,
      reason: 'Remote-only live submit guard blocked this role because it does not show remote/work-from-home eligibility.'
    };
  }

  if (!Number.isFinite(applicationScore) || applicationScore <= effectiveLiveSubmitFloor) {
    return {
      ready: false,
      reason: `Application score ${Number.isFinite(applicationScore) ? applicationScore : 'unknown'} is not above live-submit floor ${effectiveLiveSubmitFloor}.`
    };
  }

  const highRisk = (existing.optimizer?.risk_flags || []).some((flag) => flag.severity === 'high');
  if (highRisk) {
    return {
      ready: false,
      reason: 'Optimizer high-risk flag blocks live submission.'
    };
  }

  const verification = existing.gemini || {};
  const manuallyApproved = isManualApplyApproval(existing);
  if (verification.should_apply === false && !manuallyApproved) {
    return {
      ready: false,
      reason: 'AI verification previously rejected live submission.'
    };
  }

  const currentLocal = await localMatchJob(job, profile, config);
  const storedLocal = existing.local || {};
  const localScore = Number.parseInt(currentLocal.score, 10);
  const storedLocalScore = Number.parseInt(storedLocal.score, 10);
  const bestLocalScore = Math.max(
    Number.isFinite(localScore) ? localScore : 0,
    Number.isFinite(storedLocalScore) ? storedLocalScore : 0
  );

  const aligned = isProfileAlignedRole(config, job);
  if (!aligned && (currentLocal.recommendation === 'ignore' || bestLocalScore < getAiConsiderationFloor(config))) {
    return {
      ready: false,
      reason: `Current profile QA blocks live submit: ${currentLocal.reasons?.[0] || 'low local fit'}`
    };
  }

  return { ready: true, reason: '' };
}

export function isRemoteEligibleForLiveSubmit(job = {}, config = {}) {
  if (config.liveSubmitRemoteOnly === false || config.remoteOnlyLiveSubmit === false) return true;

  const source = String(job.source_site || job.source || '').toLowerCase();
  if (source === 'bruntwork') return true;

  const rawText = typeof job.raw === 'string'
    ? job.raw
    : JSON.stringify(job.raw || {});
  const text = [
    job.location,
    job.workplaceType,
    job.remoteType,
    job.title,
    job.description,
    job.requirements,
    rawText
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(remote|work from home|work-from-home|wfh|telecommute|distributed|anywhere|worldwide)\b/i.test(text)) {
    return true;
  }

  return job.raw?.remote === true || job.raw?.sourceRemoteDefault === true;
}

function isManualApplyApproval(record = {}) {
  return (
    record.acceptedViaTelegram === true ||
    record.acceptedViaDashboard === true ||
    /restaged for live retry/i.test(String(record.reason || ''))
  );
}

function bestStoredApplicationScore(record = {}) {
  const candidates = [
    record.score,
    record.optimizer?.application_score,
    record.application_score,
    record.analysis?.score
  ]
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);

  return candidates.length ? Math.max(...candidates) : NaN;
}

export function isNonEnglishJob(job) {
  const source = job.source_site || job.source || '';
  const title = String(job.title || '').toLowerCase();
  const requirements = String(job.requirements || '').toLowerCase();
  const description = String(job.description || '').toLowerCase();

  const languageRequirementMarkers = [
    'bilingual', 'fluent spanish', 'spanish speaker', 'spanish-speaking',
    'fluent german', 'german speaker', 'german-speaking',
    'fluent french', 'french speaker', 'french-speaking',
    'fluent portuguese', 'portuguese speaker', 'portuguese-speaking',
    'native spanish', 'native german', 'native french', 'native portuguese'
  ];
  const titleMarkers = [
    'deutsch', 'espanol', 'francais', 'portugues',
    'desenvolvedor', 'desenvolvedora', 'vacature', 'medewerker', 'mitarbeiter'
  ];
  const strongContentMarkers = [
    'wir suchen', 'stellenangebot', 'bewerbung', 'unbefristet', 'befristet',
    'offre d\'emploi', 'teletravail', 'remuneration',
    'banco de talentos', 'produtos financeiros', 'sao paulo', 'rio de janeiro'
  ];

  const normalized = `${title} ${requirements} ${description}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (languageRequirementMarkers.some((marker) => `${title} ${requirements}`.includes(marker))) {
    return true;
  }
  if (titleMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  const markerHits = strongContentMarkers.filter((marker) => normalized.includes(marker)).length;
  return source === 'himalayas' ? markerHits >= 2 : markerHits >= 1;

  const text = `${job.title || ''} ${job.description || ''} ${job.location || ''} ${job.company || ''}`.toLowerCase();
  const nonEnglishMarkers = [
    // German
    'deutschland', 'österreich', 'münchen', 'berlin', 'hamburg', 'frankfurt', 'köln',
    'mitarbeiter', 'unternehmen', 'bewerbung', 'vollzeit', 'teilzeit', 'möglich',
    'wir suchen', 'stellenangebot', 'unbefristet', 'befristet', 'gehalt',
    // French
    'france', 'paris', 'français', 'entreprise', 'poste', 'candidat', 'télétravail',
    'offre d\'emploi', 'rémunération', 'société',
    // Spanish
    'españa', 'trabajo', 'empresa', 'candidato', 'requisitos', 'salario',
    // Portuguese
    'brasil', 'portugal', 'empresa', 'trabalho', 'candidatura',
    // Dutch
    'nederland', 'amsterdam', 'vacature', 'medewerker',
    // Portuguese / Brazilian
    'desenvolvedor', 'desenvolvedora', 'pessoa', 'vaga', 'remota', 'clt',
    'banco de talentos', 'produtos financeiros', 'sênior', 'júnior',
    'candidatura', 'trabalho', 'brasil', 'são paulo', 'rio de janeiro'
  ];
  return nonEnglishMarkers.some((w) => text.includes(w));
}

function mergeScores(localScore, geminiScore) {
  const adjusted = Number.isFinite(geminiScore) ? geminiScore : localScore;
  return Math.round(localScore * 0.7 + adjusted * 0.3);
}

function buildAnalysis(local, gemini, optimizer, mergedScore, decision) {
  const riskReasons = (optimizer.risk_flags || []).map((flag) => `${flag.severity}: ${flag.message}`);
  return {
    score: optimizer.application_score,
    decision,
    merged_match_score: mergedScore,
    local_score: local.score,
    gemini_score: gemini.adjusted_score,
    ats_score: optimizer.ats_score,
    interview_probability: optimizer.interview_probability,
    confidence: gemini.confidence,
    should_apply: gemini.should_apply,
    verification_failed: gemini.verification_failed,
    reasons: [...(local.reasons || []), gemini.reasoning, ...riskReasons].filter(Boolean),
    matchedSkills: local.matchedSkills || [],
    missing_skills: optimizer.ats_analysis?.missing_keywords || local.missingSkills || [],
    ats_risk: gemini.ats_risk || '',
    ats_analysis: optimizer.ats_analysis,
    optimized_resume_keywords: optimizer.optimized_resume_keywords,
    improved_answers: optimizer.improved_answers,
    risk_flags: optimizer.risk_flags,
    scoring_breakdown: optimizer.scoring_breakdown,
    cover_letter: optimizer.optimized_cover_letter || gemini.improved_cover_letter || '',
    application_answers: optimizer.improved_answers || gemini.application_answers || {}
  };
}

function reviewReasonForOptimizer(optimizer) {
  if (optimizer.interview_probability < 60) {
    return `Low interview probability (${optimizer.interview_probability}). Review only; do not auto-apply.`;
  }
  if ((optimizer.risk_flags || []).length > 0) {
    return `Quality-control review required: ${optimizer.risk_flags[0].message}`;
  }
  return 'Optimizer recommends manual review before applying.';
}

export function getAiConsiderationFloor(config = {}) {
  const explicit = Number.parseInt(config.aiConsiderationFloor ?? process.env.AI_CONSIDERATION_FLOOR, 10);
  if (Number.isFinite(explicit)) return explicit;
  return 40;
}

function rowFor(job, score, decision, status, analysis = {}) {
  return {
    title: job.title,
    url: job.applicationUrl,
    source: job.source_site || job.source,
    score,
    decision,
    status,
    reasons: analysis.reasons || [],
    missingSkills: analysis.missing_skills || analysis.missingSkills || []
  };
}

function statusForApplicationResult(applyResult) {
  if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) return 'applied';
  if (applyResult.outcome === ApplicationOutcome.APPLICATION_FAILED) return 'failed';
  return 'manual_review';
}

export function isTerminalApplicationResult(applyResult = {}) {
  if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) return true;
  return /no longer accepting applications|applications? (?:are|is) closed|(?:job|role|position) (?:is |has been )?(?:closed|unavailable)|application (?:period|window) (?:has )?(?:closed|ended)/i
    .test(String(applyResult.reason || ''));
}

// Gateway sources resolve to a third-party ATS at apply time; they auto-apply
// only when ALLOW_GATEWAY_AUTO_SUBMIT is on, and only hand off to audited
// downstream adapters (the adapter + atsResolver enforce the rest).
const GATEWAY_SOURCES = new Set(['remoteok', 'remotejobsorg']);

export function getAutoApplyGate(config, job) {
  // Auto-apply gate: re-enabled after successful BruntWork pipeline test with adapters + re-verification (2026-05-30)

  if (!config.autoApply) {
    return {
      enabled: false,
      reason: 'Optimizer recommends applying, but global auto-apply is disabled. Awaiting user approval.'
    };
  }

  const source = job.source_site || job.source || 'unknown';
  if (source === 'influx') {
    return {
      enabled: false,
      reason: 'Influx Typeform automation is review-only until required-field mapping and submission proof are reliable.'
    };
  }
  const siteConfig = config.sites?.[source];
  if (siteConfig?.autoApplyEnabled !== true) {
    return {
      enabled: false,
      reason: `${source} auto-apply is disabled in config/sites.json. Awaiting user approval.`
    };
  }
  if (GATEWAY_SOURCES.has(source) && config.allowGatewayAutoSubmit !== true) {
    return {
      enabled: false,
      reason: `${source} is a gateway source that resolves to a third-party ATS. Set ALLOW_GATEWAY_AUTO_SUBMIT=true to enable audited handoff; queued for review.`
    };
  }
  if (source === 'himalayas' && !job.raw?.externalApplyUrl) {
    return {
      enabled: false,
      reason: 'Himalayas job has no direct external ATS URL yet. Queued for review to avoid the Cloudflare-protected Himalayas page.'
    };
  }
  if (config.peakHoursEnabled) {
    if (!isWithinPeakHours(config)) {
      return {
        enabled: false,
        reason: 'Outside of configured peak apply hours (queued for later)'
      };
    }
  }

  return { enabled: true, reason: '' };
}

export function getReviewPromotion(config, job, local, verification, optimizer, decision) {
  if (decision !== 'review') {
    return { promoted: false, reason: '' };
  }

  const profileName = String(config.profileName || '').toLowerCase();
  const aligned = isProfileAlignedRole(config, job);
  if (!aligned) {
    return {
      promoted: false,
      reason: reviewReasonForOptimizer(optimizer)
    };
  }

  const localScore = Number.parseInt(local?.score, 10);
  const adjustedScore = Number.parseInt(verification?.adjusted_score, 10);
  const applicationScore = Number.parseInt(optimizer?.application_score, 10);
  const verifierApproved = verification?.should_apply === true;
  const noHighRisk = !(optimizer?.risk_flags || []).some((flag) => flag.severity === 'high');
  const threshold = Number.isFinite(config.autoApplyScoreThreshold) ? config.autoApplyScoreThreshold : 55;

  if (
    noHighRisk &&
    Number.isFinite(localScore) &&
    localScore >= 40 &&
    Number.isFinite(adjustedScore) &&
    adjustedScore >= threshold &&
    Number.isFinite(applicationScore) &&
    applicationScore >= threshold
  ) {
    return {
      promoted: true,
      reason: 'Profile-aligned review role promoted because AI verification approved the fit.'
    };
  }

  return {
    promoted: false,
    reason: verifierApproved
      ? reviewReasonForOptimizer(optimizer)
      : 'AI verification did not approve live submission. Queued for review.'
  };
}

export function isProfileAlignedRole(config = {}, job = {}) {
  const profileName = String(config.profileName || '').toLowerCase();
  const source = String(job.source_site || job.source || '').toLowerCase();
  const text = `${job.title || ''} ${job.description || ''} ${job.requirements || ''}`.toLowerCase();

  if (profileName.includes('tolu')) {
    return /\b(seo|technical seo|shopify|wordpress|website|web developer|web admin|frontend|front end|backend|full stack|full-stack|javascript|html|css|e-?commerce|digital marketing|content)\b/i.test(text);
  }

  if (profileName.includes('sister')) {
    if (source === 'influx') return false;
    return /\b(customer support|customer service|customer success|virtual assistant|va assistant|administrative assistant|admin assistant|executive assistant|crm|hubspot|zendesk|data entry|calendar|lead generation|lead qualification|appointment setter|sales support|sales pipeline|business development|operations coordinator|marketing assistant|client success|telemarketer|outbound)\b/i.test(text);
  }

  return false;
}

function isWithinPeakHours(config) {
  const now = new Date();
  
  // Convert JS day (0=Sun) to our peakDays config (typically 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun)
  let dayOfWeek = now.getDay();
  if (dayOfWeek === 0) dayOfWeek = 7; 
  
  if (!config.peakDays.includes(String(dayOfWeek))) {
    return false;
  }

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours + minutes / 60.0;

  const [startH, startM] = (config.peakHoursStart || '08:00').split(':').map(Number);
  const startTime = startH + (startM || 0) / 60.0;

  const [endH, endM] = (config.peakHoursEnd || '10:00').split(':').map(Number);
  const endTime = endH + (endM || 0) / 60.0;

  return currentTime >= startTime && currentTime <= endTime;
}

async function recordJobStatus(config, job, status, details = {}) {
  // Store description for Telegram review details (truncated to save space)
  const desc = job.description || '';
  if (desc && !details.description) {
    details.description = desc.length > 2000 ? desc.slice(0, 2000) : desc;
  }
  const localRecord = await upsertJobRecord(config, job, status, details);
  await upsertGlobalJobRecord(config, job, status, details);
  return localRecord;
}
