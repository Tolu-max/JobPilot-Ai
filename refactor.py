import re

def refactor_pipeline():
    with open('src/pipeline.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update flushPendingApplyQueue logic
    old_flush = """    } else {
      const retryCount = (record.retryCount || 0) + 1;
      const terminal = isTerminalApplicationResult(applyResult);
      const effectiveRetryCount = terminal ? 3 : retryCount;
      const newStatus = effectiveRetryCount >= 3 ? 'failed' : 'pending_apply';
      queueOutcome = newStatus === 'failed' ? 'failed' : 'pending';
      if (newStatus === 'failed') res.failed = 1;
      else res.pending = 1;"""

    new_flush = """    } else {
      const { maxRetries } = await import('./applicationRetryPolicy.js');
      const retryCount = (record.retryCount || 0) + 1;
      const terminal = isTerminalApplicationResult(applyResult) || isDeterministicApplicationFailure(applyResult.reason);
      const effectiveRetryCount = terminal ? maxRetries : retryCount;
      const newStatus = effectiveRetryCount >= maxRetries ? 'manual_review' : 'pending_apply';
      queueOutcome = newStatus === 'manual_review' ? 'manual_review' : 'pending';
      if (newStatus === 'manual_review') res.manualReview = 1;
      else res.pending = 1;"""
      
    content = content.replace(old_flush, new_flush)

    # 2. Refactor runJobHunt
    # The existing runJobHunt is from line 29 to 478. Let's find it.
    match = re.search(r'export async function runJobHunt\(config, options = \{\}\) \{.*?\n\}\n', content, re.DOTALL)
    if not match:
        print("Could not find runJobHunt function")
        # Try a more forgiving regex
        match = re.search(r'export async function runJobHunt.*?^}', content, re.DOTALL | re.MULTILINE)
        if not match:
            print("Still could not find runJobHunt")
            return
            
    old_runJobHunt = match.group(0)

    new_runJobHunt = """import { PHASE_TIMEOUTS } from './config.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runJobHunt(config, options = {}) {
  resetReviewNotifCount(config);
  await appendLog('Run started', config);
  const autoApplyBudget = createAutoApplyBudget(config);
  
  // Phase 1: SCRAPE
  const profile = await loadOrBuildCandidateProfile(config);
  config.candidateProfile = profile;
  const cvData = await loadCvData(config).catch((err) => { console.warn(`[pipeline] CV parse skipped: ${err.message}`); return null; });
  if (cvData) {
    config.cvData = cvData;
    await withStartupTimeout(
      appendLog(`CV data loaded for ${config.profileName}: ${cvData.name || 'unknown'}`, config),
      5000, 'CV log append'
    ).catch(() => {});
  }
  
  let resumeText = cvData ? buildResumeTextFromCvData(cvData) : '';
  if (!resumeText) {
    resumeText = await withStartupTimeout(readResumeText(config.resumePath), 15000, 'Resume parsing').catch(() => '');
  }
  if (!resumeText.trim() && cvData) {
    const parts = [cvData.name, cvData.summary, (cvData.skills || []).join(', '), (cvData.experience || []).map(e => `${e.title} at ${e.company}`).join('; ')].filter(Boolean);
    resumeText = parts.join('\\n');
  }
  
  if (!resumeText.trim() && config.autoApply && !config.resumePlaceholder) {
    await appendLog(`Resume text missing. Skipping.`, config);
    return [];
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
    `Phase 1: Scrape`
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
      const local = await withStartupTimeout(localMatchJob(job, profile, config), PHASE_TIMEOUTS?.score || 60000, 'Score').catch(() => ({ score: 0 }));
      const aiConsiderationFloor = getAiConsiderationFloor(config);
      if (local.score < aiConsiderationFloor) {
        runSummary.jobsIgnored += 1;
        await recordJobStatus(config, job, 'ignored', { score: local.score, decision: 'ignore', local });
        continue;
      }
      const gemini = await verifyJobFit(job, profile, local, config);
      const mergedScore = mergeScores(local.score, gemini.adjusted_score);
      const optimizer = optimizeApplication({ job, candidateProfile: profile, resumeText, localAnalysis: local, aiAnalysis: gemini, config });
      await saveOptimizerArtifacts(config, job, optimizer);
      scoredJobs.push({ job, local, gemini, optimizer, mergedScore, existing });
    } catch(e) {
      runSummary.processingErrors += 1;
    }
  }

  // Checkpoint Phase
  try {
    const checkpointPath = path.join(config.profileDir, 'pipeline_checkpoint.json');
    await fs.writeFile(checkpointPath, JSON.stringify({
      timestamp: Date.now(),
      scoredJobs
    }, null, 2));
    console.log('[pipeline] Checkpoint saved.');
  } catch(e) {
    console.warn('[pipeline] Checkpoint save failed:', e.message);
  }

  // Phase 4: TRIAGE & Phase 6: APPLY
  for (const { job, local, gemini, optimizer, mergedScore, existing } of scoredJobs) {
    const effectiveScore = optimizer.application_score ?? local.score ?? 0;
    const isHardExcluded = local?.cluster?.tier === 'HARD_EXCLUSION' || (optimizer.risk_flags || []).some(f => f.severity === 'high');
    const isProvenWinner = local?.cluster?.tier === 'PROVEN_WINNER' || local?.recommendation === 'auto_apply' || (local?.cluster?.tier === 'SELECTIVE_FIT' && effectiveScore >= 85);
    
    let decision = 'ignore';
    if (isHardExcluded) decision = 'ignore';
    else if (effectiveScore >= 85 && isProvenWinner) decision = 'apply';
    else if (effectiveScore >= (config.minReviewScore || 51)) decision = 'review';
    
    const analysis = buildAnalysis(local, gemini, optimizer, mergedScore, decision);
    
    if (decision === 'apply') {
      const autoApplyGate = getAutoApplyGate(config, job, local, optimizer, decision);
      if (!autoApplyGate.enabled || !canAttemptAutoApply(autoApplyBudget, job.source || 'unknown')) {
        runSummary.jobsQueuedForReview += 1;
        await addReviewJob(job, analysis, autoApplyGate.reason || 'Limit reached', config);
        await recordJobStatus(config, job, 'reviewed', { score: effectiveScore, decision: 'review' });
        await dispatchReviewNotification({ ...job, isNewReview: true }, effectiveScore, config, runSummary);
      } else {
        consumeAutoApplyAttempt(autoApplyBudget, job.source || 'unknown');
        runSummary.jobsAutoApplyAttempts += 1;
        const applyResult = await withStartupTimeout(
          attemptApplicationOnce(job, optimizer, config), 
          PHASE_TIMEOUTS?.apply || 120000, 
          'Phase 6: Apply'
        ).catch(e => ({ outcome: 'failed', reason: e.message }));
        
        if (applyResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
          runSummary.jobsAutoApplied += 1;
          await removeReviewJob(job, config);
          await recordJobStatus(config, job, 'applied', { score: effectiveScore, decision, appliedAt: new Date().toISOString() });
        } else if (applyResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
          runSummary.jobsQueuedForReview += 1;
          await recordJobStatus(config, job, 'manual_review', { score: effectiveScore, decision: 'review', reason: applyResult.reason, terminal: true });
        } else {
          await recordJobStatus(config, job, 'failed', { score: effectiveScore, decision, reason: applyResult.reason });
        }
      }
    } else if (decision === 'review') {
      runSummary.jobsQueuedForReview += 1;
      await addReviewJob(job, analysis, 'Needs review', config);
      await recordJobStatus(config, job, 'reviewed', { score: effectiveScore, decision });
      await dispatchReviewNotification({ ...job, isNewReview: true }, effectiveScore, config, runSummary);
    } else {
      runSummary.jobsIgnored += 1;
      await recordJobStatus(config, job, 'ignored', { score: effectiveScore, decision });
    }
  }

  // Phase 5: REVIEW_FLUSH
  const pendingRun = await withStartupTimeout(
    flushPendingApplyQueue(config, autoApplyBudget),
    PHASE_TIMEOUTS?.pendingFlush || 600000,
    `Phase 5: Review Flush`
  ).catch(() => ({ manualReview: 0, blocked: 0, applied: 0, attempts: 0, failed: 0 }));

  runSummary.jobsQueuedForReview += pendingRun.manualReview + pendingRun.blocked;
  runSummary.jobsAutoApplied += pendingRun.applied;
  runSummary.jobsAutoApplyAttempts += pendingRun.attempts;
  runSummary.processingErrors += pendingRun.failed;

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
"""
    
    # We need to prepend the import if it's not already there
    content = content.replace(old_runJobHunt, new_runJobHunt)
    
    # Write back
    with open('src/pipeline.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Refactor complete.")

if __name__ == '__main__':
    refactor_pipeline()
