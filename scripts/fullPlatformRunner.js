import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication, saveOptimizerArtifacts } from '../src/applicationOptimizer.js';
import { attemptApplication } from '../src/automation.js';
import {
  ApplicationOutcome,
  ApplicationState,
  createApplicationLifecycle,
  finalizeApplication,
  transitionApplicationState,
  validateApplicationLifecycle
} from '../src/applicationStateManager.js';
import { getJobRecord, hashJob, shouldSkipProcessed, upsertJobRecord } from '../src/jobStore.js';
import { appendLog } from '../src/logger.js';
import { sendNotification } from '../src/notifications.js';
import { loadOrBuildCandidateProfile, readResumeText } from '../src/profileParser.js';
import { addReviewJob } from '../src/reviewQueue.js';
import { withRetry } from '../src/retry.js';
import { runScrapers, scraperRegistry } from '../src/scrapers/index.js';

const PROFILES = ['tolu', 'sister'];
const HIGH_SCORE = 75;
const MEDIUM_SCORE = 50;
const MEMORY_GROWTH_LIMIT_BYTES = 180 * 1024 * 1024;

process.env.TEST_PLATFORM_MODE = 'true';
process.env.TEST_MODE = 'true';
process.env.AI_MODE ||= 'MOCK';
process.env.TEST_PLATFORM_SCRAPE_MODE ||= 'mock';
process.env.HEADLESS = 'true';
process.env.MAX_JOBS_PER_RUN = '3';
process.env.TEST_PLATFORM_MAX_JOBS_PER_SITE = '3';
process.env.APPLICANT_EMAIL ||= 'platform-test@example.test';
process.env.CAPTCHA_WAIT_MS = '1';

async function main() {
  const rootDir = process.cwd();
  const reportDir = path.join(rootDir, 'test-report');
  const artifactsRoot = path.join(rootDir, 'test-artifacts');
  const runtimeRoot = path.join(artifactsRoot, '_runtime');

  await resetOutputDirectory(rootDir, reportDir);
  await fs.mkdir(artifactsRoot, { recursive: true });
  for (const ownedArtifactDir of ['tolu', 'sister', '_runtime', '_health', '_platform-fixtures']) {
    await resetOutputDirectory(rootDir, path.join(artifactsRoot, ownedArtifactDir));
  }
  await fs.mkdir(runtimeRoot, { recursive: true });

  const report = createEmptyReport();
  const memoryStart = process.memoryUsage().heapUsed;
  report.performance.memory.startHeapBytes = memoryStart;

  const health = await runModuleHealthChecks({ rootDir, artifactsRoot, runtimeRoot, report });
  report.moduleSummary = summarizeHealth(health);
  report.moduleHealth = health;

  const profileRuns = {};
  for (const profileName of PROFILES) {
    profileRuns[profileName] = await runProfilePlatformTest({
      profileName,
      rootDir,
      artifactsRoot,
      runtimeRoot,
      report
    });
  }

  validateProfileIsolation(profileRuns, report);
  await finalizeReportMetrics({ report, runtimeRoot, memoryStart });
  await writeReports(report, reportDir);

  const failedModules = Object.entries(report.moduleSummary)
    .filter(([, status]) => status === 'FAIL')
    .map(([name]) => name);
  const hasFailures = failedModules.length > 0 || report.failures.length > 0 || report.stateMachineErrors.length > 0;

  if (hasFailures) {
    console.error(`Full platform validation failed. Report: ${path.join(reportDir, 'full-platform-report.json')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Full platform validation passed. Report: ${path.join(reportDir, 'full-platform-report.json')}`);
}

function createEmptyReport() {
  return {
    generatedAt: new Date().toISOString(),
    mode: {
      TEST_PLATFORM_MODE: true,
      TEST_MODE: true,
      AI_MODE: process.env.AI_MODE || 'MOCK',
      TEST_PLATFORM_SCRAPE_MODE: process.env.TEST_PLATFORM_SCRAPE_MODE || 'mock'
    },
    totalJobsProcessed: 0,
    jobsPerSite: {},
    jobsScored: {
      high: 0,
      medium: 0,
      low: 0
    },
    aiCallsMade: 0,
    aiCallsSkipped: 0,
    mockAiCalls: 0,
    applicationsAttempted: 0,
    applicationsConfirmedSuccess: 0,
    applicationsFailed: 0,
    reviewQueueSize: 0,
    deduplicationHits: 0,
    captchaTriggers: 0,
    stateMachineErrors: [],
    moduleSummary: {},
    moduleHealth: [],
    profiles: {},
    decisions: {
      applied_successfully: 0,
      review_required: 0,
      skipped: 0,
      failed: 0
    },
    performance: {
      memory: {
        startHeapBytes: 0,
        endHeapBytes: 0,
        growthBytes: 0,
        limitBytes: MEMORY_GROWTH_LIMIT_BYTES,
        pass: false
      },
      scraperRetriesStable: false,
      playwrightSessionReuse: {
        pass: false,
        snapshotContextsCreated: 0,
        jobsSnapshotted: 0
      },
      schedulerDuplicateGuard: false
    },
    failures: []
  };
}

async function runProfilePlatformTest({ profileName, rootDir, artifactsRoot, runtimeRoot, report }) {
  const config = buildPlatformConfig({ profileName, rootDir, artifactsRoot, runtimeRoot });
  await fs.mkdir(config.testResultsDir, { recursive: true });
  await appendLog('Full platform validation started.', config);

  const profile = await loadOrBuildCandidateProfile(config);
  const resumeText = await readResumeText(config.resumePath);
  const profileReport = initializeProfileReport(config, profile, resumeText);
  report.profiles[profileName] = profileReport;

  validateProfileConfig(config, profile, resumeText, report);

  const scrapeResult = await runScrapers(config);
  profileReport.scrapeResult = {
    jobsScanned: scrapeResult.jobsScanned,
    dedupedJobs: scrapeResult.dedupedJobs,
    siteResults: scrapeResult.siteResults,
    errors: scrapeResult.errors
  };
  report.deduplicationHits += scrapeResult.dedupedJobs || 0;

  const snapshotBrowser = await chromium.launch({ headless: true });
  const snapshotContext = await snapshotBrowser.newContext({ viewport: { width: 1280, height: 900 } });
  const snapshotPage = await snapshotContext.newPage();
  report.performance.playwrightSessionReuse.snapshotContextsCreated += 1;

  try {
    for (const job of scrapeResult.jobs) {
      await processJobThroughPlatform({
        job,
        config,
        profile,
        resumeText,
        snapshotPage,
        report,
        profileReport
      });
    }
  } finally {
    await snapshotPage.close().catch(() => {});
    await snapshotContext.close();
    await snapshotBrowser.close();
  }

  await appendLog('Full platform validation finished.', config);
  return profileReport;
}

async function processJobThroughPlatform({
  job,
  config,
  profile,
  resumeText,
  snapshotPage,
  report,
  profileReport
}) {
  const jobHash = hashJob(job);
  const artifactDir = path.join(config.testResultsDir, jobHash);
  const site = job.source_site || job.source || 'unknown';
  const pipelineLog = [];
  const jobRecord = {
    profile: config.profileName,
    job_hash: jobHash,
    title: job.title,
    company: job.company || '',
    site,
    applicationUrl: job.applicationUrl,
    finalDecision: '',
    localScore: 0,
    aiCalled: false,
    artifactDir
  };

  await fs.mkdir(artifactDir, { recursive: true });
  await writeJson(path.join(artifactDir, 'job.json'), job);
  pipelineLog.push(step('SCRAPED', 'Job collected from platform-mode scraper.'));
  pipelineLog.push(step('NORMALIZED', 'Job contains normalized source, URL, title, company, and hash fields.'));

  report.totalJobsProcessed += 1;
  report.jobsPerSite[site] = (report.jobsPerSite[site] || 0) + 1;
  profileReport.jobsProcessed += 1;
  profileReport.jobsPerSite[site] = (profileReport.jobsPerSite[site] || 0) + 1;

  const existingRecord = await getJobRecord(config, job);
  const duplicate = shouldSkipProcessed(existingRecord);
  await writeJson(path.join(artifactDir, 'dedupe_result.json'), {
    duplicate,
    existingRecord
  });
  pipelineLog.push(step('DEDUPLICATED', duplicate ? 'Existing processed record found.' : 'No processed record found.'));

  if (duplicate) {
    report.deduplicationHits += 1;
    jobRecord.finalDecision = 'skipped';
    report.decisions.skipped += 1;
    await writeJobArtifacts({
      artifactDir,
      pipelineLog,
      local: null,
      ai: { skipped: true, reason: 'Duplicate job.' },
      optimizer: null,
      applicationResult: null
    });
    await captureJobSnapshot(snapshotPage, artifactDir, job, {
      title: job.title,
      decision: 'skipped',
      reason: 'Duplicate job.'
    });
    profileReport.jobs.push(jobRecord);
    return;
  }

  const local = localMatchJob(job, profile);
  jobRecord.localScore = local.score;
  profileReport.scoreByTitle[job.title] ||= [];
  profileReport.scoreByTitle[job.title].push(local.score);
  pipelineLog.push(step('SCORED', `localMatcher score ${local.score}; recommendation ${local.recommendation}.`));
  validateLocalMatcherOutput(local, report, { profile: config.profileName, jobHash });
  countScoreBucket(report, local.score);

  if (local.score < HIGH_SCORE) {
    report.aiCallsSkipped += 1;
    jobRecord.aiCalled = false;
    jobRecord.finalDecision = 'skipped';
    report.decisions.skipped += 1;
    await upsertJobRecord(config, job, 'ignored', {
      score: local.score,
      decision: 'skipped',
      local
    });
    await writeJobArtifacts({
      artifactDir,
      pipelineLog,
      local,
      ai: { skipped: true, reason: `localMatcher score ${local.score} is below ${HIGH_SCORE}.` },
      optimizer: null,
      applicationResult: null
    });
    await captureJobSnapshot(snapshotPage, artifactDir, job, {
      title: job.title,
      score: local.score,
      decision: 'skipped',
      reason: 'Below localMatcher threshold.'
    });
    report.performance.playwrightSessionReuse.jobsSnapshotted += 1;
    profileReport.jobs.push(jobRecord);
    return;
  }

  const ai = await verifyJobFit(job, profile, local, config);
  report.aiCallsMade += 1;
  if (isMockAiResponse(ai)) report.mockAiCalls += 1;
  jobRecord.aiCalled = true;
  pipelineLog.push(step('AI_VERIFIED', `${config.aiMode} ${config.aiProvider} verification returned ${ai.adjusted_score}.`));
  validateAiOutput(ai, report, { profile: config.profileName, jobHash });

  const optimizer = optimizeApplication({
    job,
    candidateProfile: profile,
    resumeText,
    localAnalysis: local,
    aiAnalysis: ai
  });
  pipelineLog.push(
    step(
      'OPTIMIZED',
      `applicationOptimizer score ${optimizer.application_score}; recommendation ${optimizer.recommendation}.`
    )
  );
  validateOptimizerOutput(optimizer, report, { profile: config.profileName, jobHash });
  await saveOptimizerArtifacts(config, job, optimizer);

  report.applicationsAttempted += 1;
  pipelineLog.push(step('AUTOMATION_STARTED', 'automation.js invoked in TEST_MODE only.'));
  const applicationResult = await attemptApplication(job, optimizer, config);
  pipelineLog.push(
    step('AUTOMATION_FINISHED', `${applicationResult.finalState || 'UNKNOWN'}: ${applicationResult.reason || ''}`)
  );

  const lifecycleValidation = validateApplicationLifecycle(applicationResult.lifecycle);
  await writeJson(path.join(artifactDir, 'state_transitions.json'), {
    ok: lifecycleValidation.ok,
    errors: lifecycleValidation.errors,
    lifecycle: applicationResult.lifecycle,
    debugSnapshot: lifecycleValidation.debugSnapshot
  });

  if (!lifecycleValidation.ok) {
    const stateError = {
      profile: config.profileName,
      job_hash: jobHash,
      title: job.title,
      errors: lifecycleValidation.errors,
      debugSnapshot: lifecycleValidation.debugSnapshot
    };
    report.stateMachineErrors.push(stateError);
    report.failures.push(`Invalid state transition for ${config.profileName}/${jobHash}.`);
    await appendLog(`State machine error for ${job.title}: ${JSON.stringify(lifecycleValidation.errors)}`, config);
  }

  const finalDecision = finalDecisionForApplication(applicationResult);
  jobRecord.finalDecision = finalDecision;
  report.decisions[finalDecision] += 1;
  if (applicationResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
    report.applicationsConfirmedSuccess += 1;
    await upsertJobRecord(config, job, 'applied', {
      score: optimizer.application_score,
      decision: optimizer.recommendation,
      local,
      ai,
      optimizer,
      application: applicationResult
    });
  } else if (applicationResult.outcome === ApplicationOutcome.APPLICATION_FAILED) {
    report.applicationsFailed += 1;
    await upsertJobRecord(config, job, 'failed', {
      score: optimizer.application_score,
      decision: optimizer.recommendation,
      local,
      ai,
      optimizer,
      application: applicationResult
    });
  } else {
    await addReviewJob(
      job,
      buildReviewAnalysis(local, ai, optimizer),
      applicationResult.reason || 'TEST_MODE review required.',
      config,
      applicationResult
    );
    await upsertJobRecord(config, job, 'manual_review', {
      score: optimizer.application_score,
      decision: optimizer.recommendation,
      local,
      ai,
      optimizer,
      application: applicationResult
    });
  }

  if (/captcha/i.test(applicationResult.reason || '')) {
    report.captchaTriggers += 1;
  }

  profileReport.generatedApplicationOutputs.push(optimizer.optimized_cover_letter || '');
  await writeJobArtifacts({
    artifactDir,
    pipelineLog,
    local,
    ai,
    optimizer,
    applicationResult
  });
  await captureJobSnapshot(snapshotPage, artifactDir, job, {
    title: job.title,
    score: local.score,
    decision: finalDecision,
    reason: applicationResult.reason
  });
  report.performance.playwrightSessionReuse.jobsSnapshotted += 1;
  profileReport.jobs.push(jobRecord);
}

async function runModuleHealthChecks({ rootDir, artifactsRoot, runtimeRoot, report }) {
  const checks = [];
  const healthConfig = {
    ...buildPlatformConfig({
      profileName: 'tolu',
      rootDir,
      artifactsRoot,
      runtimeRoot,
      suffix: 'health'
    }),
    reviewPath: path.join(runtimeRoot, 'healthReviewQueue.json')
  };
  const healthDir = path.join(artifactsRoot, '_health');
  await fs.mkdir(healthDir, { recursive: true });

  await runHealthCheck(checks, 'scraper health', async () => {
    const result = await runScrapers(healthConfig);
    const expectedSites = Object.keys(scraperRegistry).length;
    const overLimit = result.siteResults.filter((site) => site.jobCount > 3);
    assertHealth(result.siteResults.length === expectedSites, `Expected ${expectedSites} scraper results.`);
    assertHealth(overLimit.length === 0, `Scrapers exceeded platform limit: ${overLimit.map((item) => item.site).join(', ')}`);
    assertHealth(result.errors.length === 0, `Scraper errors: ${JSON.stringify(result.errors)}`);
    return {
      sitesChecked: result.siteResults.length,
      jobsReturned: result.jobs.length,
      jobsPerSite: Object.fromEntries(result.siteResults.map((item) => [item.site, item.jobCount]))
    };
  });

  const profile = await loadOrBuildCandidateProfile(healthConfig);
  const resumeText = await readResumeText(healthConfig.resumePath);
  const sampleJob = {
    title: 'Technical SEO and Shopify Specialist',
    company: 'Health Digital',
    source: 'health',
    source_site: 'health',
    applicationUrl: await createHealthForm(healthDir, 'optimizer-form.html'),
    description: 'Remote SEO, Shopify, WordPress, HTML, CSS, JavaScript and technical SEO work.',
    requirements: 'SEO, Shopify, WordPress, HTML, CSS, JavaScript',
    responsibilities: 'Improve search visibility and maintain e-commerce pages.'
  };
  const local = localMatchJob(sampleJob, profile);

  await runHealthCheck(checks, 'localMatcher output validity', async () => {
    validateLocalMatcherShape(local);
    return { score: local.score, recommendation: local.recommendation };
  });

  const ai = await verifyJobFit(sampleJob, profile, local, healthConfig);
  await runHealthCheck(checks, 'AI response validity', async () => {
    validateAiShape(ai);
    return {
      adjusted_score: ai.adjusted_score,
      provider: ai.provider || healthConfig.aiProvider,
      mock: isMockAiResponse(ai),
      modelUsed: ai.model_used || ai.ai_router?.modelUsed || ''
    };
  });

  const optimizer = optimizeApplication({
    job: sampleJob,
    candidateProfile: profile,
    resumeText,
    localAnalysis: local,
    aiAnalysis: ai
  });
  await runHealthCheck(checks, 'applicationOptimizer output correctness', async () => {
    validateOptimizerShape(optimizer);
    return {
      application_score: optimizer.application_score,
      ats_score: optimizer.ats_score,
      recommendation: optimizer.recommendation
    };
  });

  await runHealthCheck(checks, 'Playwright execution success', async () => {
    const result = await attemptApplication(sampleJob, optimizer, {
      ...healthConfig,
      simulateAutomation: false
    });
    assertHealth(result.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW, 'TEST_MODE should require manual review.');
    assertHealth(Boolean(result.debugDir), 'Automation did not return a debug directory.');
    return { outcome: result.outcome, finalState: result.finalState, debugDir: result.debugDir };
  });

  await runHealthCheck(checks, 'CAPTCHA detection triggers', async () => {
    const captchaJob = {
      ...sampleJob,
      title: 'Captcha Health Check',
      applicationUrl: await createHealthForm(healthDir, 'captcha-form.html', { captcha: true })
    };
    const result = await attemptApplication(captchaJob, optimizer, {
      ...healthConfig,
      simulateAutomation: false,
      captchaWaitMs: 1,
      browserProfileDir: path.join(runtimeRoot, 'health-captcha-browser')
    });
    assertHealth(/captcha/i.test(result.reason || ''), `Expected CAPTCHA reason, got: ${result.reason}`);
    report.captchaTriggers += 1;
    return { outcome: result.outcome, reason: result.reason };
  });

  await runHealthCheck(checks, 'deduplication correctness', async () => {
    const config = {
      jobStorePath: path.join(runtimeRoot, 'health-dedupe', 'processedJobs.json')
    };
    await upsertJobRecord(config, sampleJob, 'ignored', { score: 10 });
    const record = await getJobRecord(config, sampleJob);
    assertHealth(shouldSkipProcessed(record), 'Processed job was not detected as a duplicate.');
    report.deduplicationHits += 1;
    return { job_hash: record.job_hash, status: record.status };
  });

  await runHealthCheck(checks, 'logging system', async () => {
    await appendLog('Health check log entry.', healthConfig);
    const text = await fs.readFile(healthConfig.logPath, 'utf8');
    assertHealth(text.includes('Health check log entry.'), 'Log entry was not written.');
    return { logPath: healthConfig.logPath };
  });

  await runHealthCheck(checks, 'review queue system', async () => {
    await addReviewJob(sampleJob, { score: 88, cover_letter: 'Health check cover letter.' }, 'Health review.', healthConfig);
    const queue = JSON.parse(await fs.readFile(healthConfig.reviewPath, 'utf8'));
    assertHealth(queue.length >= 1, 'Review queue did not receive a job.');
    return { reviewPath: healthConfig.reviewPath, queueSize: queue.length };
  });

  await runHealthCheck(checks, 'notification system test mode', async () => {
    await sendNotification('Health check notification.', healthConfig);
    const text = await fs.readFile(healthConfig.logPath, 'utf8');
    assertHealth(text.includes('Notification:'), 'Notification did not fall back to log output.');
    return { transport: 'log', logPath: healthConfig.logPath };
  });

  await runHealthCheck(checks, 'state machine validation', async () => {
    const lifecycle = createApplicationLifecycle(sampleJob);
    transitionApplicationState(lifecycle, ApplicationState.SCORED, 'Scored.');
    transitionApplicationState(lifecycle, ApplicationState.SELECTED_FOR_APPLICATION, 'Selected.');
    transitionApplicationState(lifecycle, ApplicationState.FORM_OPENED, 'Opened.');
    transitionApplicationState(lifecycle, ApplicationState.FORM_FILLED, 'Filled.');
    transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, 'Submitted.');
    finalizeApplication(lifecycle, ApplicationState.CONFIRMED_SUCCESS, 'Confirmed.');

    const valid = validateApplicationLifecycle(lifecycle);
    assertHealth(valid.ok, `Expected success path to be valid: ${JSON.stringify(valid.errors)}`);

    for (const finalState of [ApplicationState.FAILED, ApplicationState.NEEDS_MANUAL_REVIEW]) {
      const finalLifecycle = createApplicationLifecycle({ ...sampleJob, title: `${sampleJob.title} ${finalState}` });
      transitionApplicationState(finalLifecycle, ApplicationState.SCORED, 'Scored.');
      finalizeApplication(finalLifecycle, finalState, 'Terminal validation.');
      const validation = validateApplicationLifecycle(finalLifecycle);
      assertHealth(validation.ok, `Expected ${finalState} path to be valid.`);
    }

    const invalidLifecycle = createApplicationLifecycle({ ...sampleJob, title: 'Invalid Transition' });
    transitionApplicationState(invalidLifecycle, ApplicationState.FORM_FILLED, 'Invalid skip.');
    const invalid = validateApplicationLifecycle(invalidLifecycle);
    assertHealth(!invalid.ok, 'Validator did not detect invalid SCRAPED -> FORM_FILLED transition.');
    return { validTransitionsChecked: 3, invalidTransitionDetected: true };
  });

  await runHealthCheck(checks, 'scraper retries stable', async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Intentional transient scraper failure.');
        return 'ok';
      },
      { retries: 2, delayMs: 1 }
    );
    assertHealth(value === 'ok' && attempts === 2, `Retry attempts were unstable: ${attempts}`);
    report.performance.scraperRetriesStable = true;
    return { attempts };
  });

  await runHealthCheck(checks, 'scheduler duplicate guard', async () => {
    const schedulerSource = await fs.readFile(path.join(rootDir, 'src', 'scheduler.js'), 'utf8');
    const hasGuard =
      schedulerSource.includes('let running = false') &&
      schedulerSource.includes('Scheduler skipped tick because previous run is still active.') &&
      schedulerSource.includes('running = false');
    assertHealth(hasGuard, 'Scheduler running guard was not found.');
    report.performance.schedulerDuplicateGuard = true;
    return { guarded: true };
  });

  return checks;
}

function buildPlatformConfig({ profileName, rootDir, artifactsRoot, runtimeRoot, suffix = '' }) {
  const config = buildConfig(['node', 'full-platform', `--profile=${profileName}`]);
  const runtimeName = suffix ? `${profileName}-${suffix}` : profileName;
  const profileRuntimeDir = path.join(runtimeRoot, runtimeName);
  const profileArtifactDir = path.join(artifactsRoot, profileName);
  const enabledSites = Object.keys(scraperRegistry);
  const sites = {};

  for (const [index, site] of enabledSites.entries()) {
    sites[site] = {
      ...(config.sites?.[site] || {}),
      enabled: true,
      priority: index + 1,
      maxJobsPerRun: 3,
      cooldownMinutes: 0,
      autoApplyEnabled: true
    };
  }

  return {
    ...config,
    rootDir,
    testPlatformMode: true,
    platformScrapeMode: process.env.TEST_PLATFORM_SCRAPE_MODE || 'mock',
    aiMode: process.env.AI_MODE || 'MOCK',
    aiProvider: config.aiProvider || 'gemini',
    testMode: true,
    headless: true,
    autoApply: true,
    allowDuplicateJobs: true,
    maxJobsPerRun: 3,
    geminiMinLocalScore: HIGH_SCORE,
    applicantEmail: config.applicantEmail || `${profileName}@platform-test.example`,
    telegramBotToken: '',
    telegramChatId: '',
    minDelayMs: 1,
    maxDelayMs: 1,
    captchaWaitMs: 1,
    sites,
    enabledSites,
    siteRunStatePath: path.join(profileRuntimeDir, 'siteRunState.json'),
    candidateProfilePath: path.join(profileRuntimeDir, 'candidateProfile.json'),
    jobStorePath: path.join(profileRuntimeDir, 'processedJobs.json'),
    globalJobStorePath: path.join(runtimeRoot, 'globalProcessedJobs.json'),
    reviewPath: path.join(runtimeRoot, 'reviewQueue.json'),
    logPath: path.join(profileRuntimeDir, 'platform.log'),
    aiRouterLogPath: path.join(profileRuntimeDir, 'aiRouter.log'),
    aiCachePath: path.join(profileRuntimeDir, 'aiCache.json'),
    debugRootDir: profileArtifactDir,
    testResultsDir: profileArtifactDir,
    browserProfileDir: path.join(profileRuntimeDir, 'browser-profile')
  };
}

function initializeProfileReport(config, profile, resumeText) {
  return {
    profileName: config.profileName,
    displayName: config.displayName,
    resumePath: config.resumePath,
    resumeExists: false,
    resumeTextAvailable: Boolean(resumeText),
    careerBrainPromptPath: config.careerBrainPromptPath,
    careerBrainPromptLoaded: Boolean(config.careerBrainPrompt),
    candidateName: profile.name || '',
    jobsProcessed: 0,
    jobsPerSite: {},
    scoreByTitle: {},
    generatedApplicationOutputs: [],
    scrapeResult: null,
    jobs: [],
    validation: {
      pass: true,
      errors: []
    }
  };
}

function validateProfileConfig(config, profile, resumeText, report) {
  const profileReport = report.profiles[config.profileName];
  const errors = profileReport.validation.errors;

  if (!config.resumePath.includes(path.join('profiles', config.profileName)) && config.profileName === 'tolu') {
    errors.push('Tolu resume is not resolved from the tolu profile directory.');
  }
  if (config.profileName === 'sister' && !/TEMILOLUWA RUTH OYELOLA/i.test(path.basename(config.resumePath))) {
    errors.push('Sister resume path does not point to the configured sister resume.');
  }
  if (!profile.name) {
    errors.push('Candidate profile has no name.');
  }
  if (!resumeText && !config.resumePlaceholder) {
    errors.push('Resume text could not be read.');
  }
  if (!config.careerBrainPrompt) {
    errors.push('Career brain prompt was not loaded.');
  }

  profileReport.resumeExists = Boolean(resumeText || config.resumePlaceholder);
  profileReport.validation.pass = errors.length === 0;
  for (const error of errors) {
    report.failures.push(`${config.profileName}: ${error}`);
  }
}

function validateProfileIsolation(profileRuns, report) {
  const tolu = profileRuns.tolu;
  const sister = profileRuns.sister;
  if (!tolu || !sister) return;

  const toluSeo = average(tolu.scoreByTitle['Technical SEO and Shopify Specialist']);
  const sisterSeo = average(sister.scoreByTitle['Technical SEO and Shopify Specialist']);
  const toluSupport = average(tolu.scoreByTitle['Customer Support and CRM Assistant']);
  const sisterSupport = average(sister.scoreByTitle['Customer Support and CRM Assistant']);

  report.profileDifferentiation = {
    toluSeo,
    sisterSeo,
    toluSupport,
    sisterSupport,
    pass: true,
    checks: []
  };

  if (!(toluSeo > sisterSeo + 20)) {
    report.profileDifferentiation.pass = false;
    report.profileDifferentiation.checks.push('Tolu should score much higher than sister on SEO/Shopify roles.');
  }
  if (!(sisterSupport > toluSupport + 20)) {
    report.profileDifferentiation.pass = false;
    report.profileDifferentiation.checks.push('Sister should score much higher than Tolu on support/CRM roles.');
  }

  const toluOutputs = tolu.generatedApplicationOutputs.join('\n').toLowerCase();
  const sisterOutputs = sister.generatedApplicationOutputs.join('\n').toLowerCase();
  if (!toluOutputs.includes('toluwalope')) {
    report.profileDifferentiation.pass = false;
    report.profileDifferentiation.checks.push('Tolu application outputs did not include the Tolu profile name.');
  }
  if (!sisterOutputs.includes('sister')) {
    report.profileDifferentiation.pass = false;
    report.profileDifferentiation.checks.push('Sister application outputs did not include the Sister profile name.');
  }
  if (sisterOutputs.includes('toluwalope')) {
    report.profileDifferentiation.pass = false;
    report.profileDifferentiation.checks.push('Sister application outputs appear to include Tolu profile data.');
  }

  if (!report.profileDifferentiation.pass) {
    report.failures.push(...report.profileDifferentiation.checks);
  }
}

async function finalizeReportMetrics({ report, runtimeRoot, memoryStart }) {
  report.reviewQueueSize = await readReviewQueueSize(path.join(runtimeRoot, 'reviewQueue.json'));
  const memoryEnd = process.memoryUsage().heapUsed;
  report.performance.memory.endHeapBytes = memoryEnd;
  report.performance.memory.growthBytes = memoryEnd - memoryStart;
  report.performance.memory.pass = report.performance.memory.growthBytes <= MEMORY_GROWTH_LIMIT_BYTES;
  report.performance.playwrightSessionReuse.pass =
    report.performance.playwrightSessionReuse.snapshotContextsCreated <= PROFILES.length &&
    report.performance.playwrightSessionReuse.jobsSnapshotted === report.totalJobsProcessed;

  if (!report.performance.memory.pass) {
    report.failures.push(`Heap growth exceeded limit: ${report.performance.memory.growthBytes} bytes.`);
  }
  if (!report.performance.playwrightSessionReuse.pass) {
    report.failures.push('Playwright snapshot context reuse check failed.');
  }
  if (!report.performance.scraperRetriesStable) {
    report.failures.push('Scraper retry stability check failed.');
  }
  if (!report.performance.schedulerDuplicateGuard) {
    report.failures.push('Scheduler duplicate guard check failed.');
  }
}

async function writeReports(report, reportDir) {
  await fs.mkdir(reportDir, { recursive: true });
  await writeJson(path.join(reportDir, 'full-platform-report.json'), report);
  await fs.writeFile(path.join(reportDir, 'full-platform-report.txt'), renderTextReport(report), 'utf8');
}

function renderTextReport(report) {
  const moduleLines = Object.entries(report.moduleSummary)
    .map(([name, status]) => `- ${name}: ${status}`)
    .join('\n');
  const siteLines = Object.entries(report.jobsPerSite)
    .map(([site, count]) => `- ${site}: ${count}`)
    .join('\n');
  const failureLines = report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`).join('\n') : '- none';

  return `Full Platform Validation Report
Generated: ${report.generatedAt}
Mode: TEST_PLATFORM_MODE=${report.mode.TEST_PLATFORM_MODE}, TEST_MODE=${report.mode.TEST_MODE}, AI_MODE=${report.mode.AI_MODE}, SCRAPE_MODE=${report.mode.TEST_PLATFORM_SCRAPE_MODE}

Summary
- Total jobs processed: ${report.totalJobsProcessed}
- AI calls made: ${report.aiCallsMade}
- AI calls skipped: ${report.aiCallsSkipped}
- Applications attempted: ${report.applicationsAttempted}
- Applications confirmed success: ${report.applicationsConfirmedSuccess}
- Applications failed: ${report.applicationsFailed}
- Review queue size: ${report.reviewQueueSize}
- Deduplication hits: ${report.deduplicationHits}
- CAPTCHA triggers: ${report.captchaTriggers}
- State machine errors: ${report.stateMachineErrors.length}

Jobs Per Site
${siteLines}

Score Buckets
- High: ${report.jobsScored.high}
- Medium: ${report.jobsScored.medium}
- Low: ${report.jobsScored.low}

Decisions
- applied_successfully: ${report.decisions.applied_successfully}
- review_required: ${report.decisions.review_required}
- skipped: ${report.decisions.skipped}
- failed: ${report.decisions.failed}

Module Health
${moduleLines}

Performance
- Heap growth bytes: ${report.performance.memory.growthBytes}
- Memory check: ${report.performance.memory.pass ? 'PASS' : 'FAIL'}
- Scraper retries stable: ${report.performance.scraperRetriesStable ? 'PASS' : 'FAIL'}
- Playwright sessions reused: ${report.performance.playwrightSessionReuse.pass ? 'PASS' : 'FAIL'}
- Scheduler duplicate guard: ${report.performance.schedulerDuplicateGuard ? 'PASS' : 'FAIL'}

Profile Differentiation
${JSON.stringify(report.profileDifferentiation || {}, null, 2)}

Failures
${failureLines}
`;
}

async function writeJobArtifacts({ artifactDir, pipelineLog, local, ai, optimizer, applicationResult }) {
  await writeJson(path.join(artifactDir, 'pipeline_log.json'), pipelineLog);
  await writeJson(path.join(artifactDir, 'local_matcher.json'), local || { skipped: true });
  await writeJson(path.join(artifactDir, 'ai_output.json'), ai || { skipped: true });
  await writeJson(path.join(artifactDir, 'optimizer_output.json'), optimizer || { skipped: true });
  await writeJson(path.join(artifactDir, 'automation_result.json'), applicationResult || { skipped: true });
  await fs.writeFile(
    path.join(artifactDir, 'logs.txt'),
    pipelineLog.map((item) => `[${item.at}] ${item.stage}: ${item.message}`).join('\n') + '\n',
    'utf8'
  );

  if (!applicationResult?.lifecycle) {
    await writeJson(path.join(artifactDir, 'state_transitions.json'), {
      ok: true,
      skippedBeforeApplication: true,
      pipelineTransitions: pipelineLog
    });
  }
}

async function captureJobSnapshot(snapshotPage, artifactDir, job, summary) {
  const html = renderJobSnapshot(job, summary);
  await fs.writeFile(path.join(artifactDir, 'job_snapshot.html'), html, 'utf8');
  await snapshotPage.setContent(html, { waitUntil: 'domcontentloaded' });
  await snapshotPage.screenshot({ path: path.join(artifactDir, 'screenshot_job_snapshot.png'), fullPage: true });
}

function renderJobSnapshot(job, summary = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(job.title || 'Job Snapshot')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #18212f; background: #f7f9fb; }
    main { max-width: 880px; margin: 0 auto; background: #fff; border: 1px solid #d8e0e8; border-radius: 8px; padding: 24px; }
    dl { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; }
    dt { font-weight: 700; color: #334155; }
    dd { margin: 0; }
    pre { white-space: pre-wrap; background: #eef3f8; padding: 16px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(job.title)}</h1>
    <dl>
      <dt>Company</dt><dd>${escapeHtml(job.company || '')}</dd>
      <dt>Source</dt><dd>${escapeHtml(job.source_site || job.source || '')}</dd>
      <dt>Score</dt><dd>${escapeHtml(summary.score ?? '')}</dd>
      <dt>Decision</dt><dd>${escapeHtml(summary.decision || '')}</dd>
      <dt>Reason</dt><dd>${escapeHtml(summary.reason || '')}</dd>
      <dt>URL</dt><dd>${escapeHtml(job.applicationUrl || '')}</dd>
    </dl>
    <h2>Description</h2>
    <pre>${escapeHtml(job.description || '')}</pre>
    <h2>Requirements</h2>
    <pre>${escapeHtml(job.requirements || '')}</pre>
  </main>
</body>
</html>
`;
}

async function createHealthForm(dir, filename, options = {}) {
  const filePath = path.join(dir, filename);
  const captcha = options.captcha
    ? '<div class="g-recaptcha" data-sitekey="platform-test">captcha verification required</div>'
    : '';
  await fs.writeFile(
    filePath,
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Health Form</title></head>
<body>
  <form>
    ${captcha}
    <label>Email <input type="email" name="email" required /></label>
    <label>Resume <input type="file" name="resume" /></label>
    <label>Cover <textarea name="cover"></textarea></label>
    <label>Why fit <textarea name="why_fit"></textarea></label>
    <button type="submit">Submit Application</button>
  </form>
</body>
</html>
`,
    'utf8'
  );
  return pathToFileURL(filePath).toString();
}

function buildReviewAnalysis(local, ai, optimizer) {
  return {
    score: optimizer.application_score,
    local_score: local.score,
    gemini_score: ai.adjusted_score,
    confidence: ai.confidence,
    reasons: [ai.reasoning, ...(local.reasons || [])].filter(Boolean),
    missing_skills: optimizer.ats_analysis?.missing_keywords || [],
    cover_letter: optimizer.optimized_cover_letter || ai.improved_cover_letter || '',
    application_answers: optimizer.improved_answers || ai.application_answers || {}
  };
}

function finalDecisionForApplication(applicationResult) {
  if (applicationResult.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) return 'applied_successfully';
  if (applicationResult.outcome === ApplicationOutcome.APPLICATION_FAILED) return 'failed';
  return 'review_required';
}

function isMockAiResponse(ai = {}) {
  return Boolean(ai.mock || ai.ai_router?.mock || ai.model_used === 'mock-router' || ai.ai_router?.modelUsed === 'mock-router');
}

function countScoreBucket(report, score) {
  if (score >= HIGH_SCORE) {
    report.jobsScored.high += 1;
  } else if (score >= MEDIUM_SCORE) {
    report.jobsScored.medium += 1;
  } else {
    report.jobsScored.low += 1;
  }
}

function validateLocalMatcherOutput(local, report, context) {
  try {
    validateLocalMatcherShape(local);
  } catch (error) {
    report.failures.push(`${context.profile}/${context.jobHash}: localMatcher output invalid: ${error.message}`);
  }
}

function validateAiOutput(ai, report, context) {
  try {
    validateAiShape(ai);
  } catch (error) {
    report.failures.push(`${context.profile}/${context.jobHash}: AI output invalid: ${error.message}`);
  }
}

function validateOptimizerOutput(optimizer, report, context) {
  try {
    validateOptimizerShape(optimizer);
  } catch (error) {
    report.failures.push(`${context.profile}/${context.jobHash}: optimizer output invalid: ${error.message}`);
  }
}

function validateLocalMatcherShape(local) {
  assertHealth(local && typeof local === 'object', 'localMatcher did not return an object.');
  assertHealth(Number.isFinite(local.score) && local.score >= 0 && local.score <= 100, 'localMatcher score is invalid.');
  assertHealth(['ignore', 'review', 'auto_apply', 'instant_apply'].includes(local.recommendation), 'Invalid recommendation.');
  assertHealth(Array.isArray(local.reasons), 'localMatcher reasons must be an array.');
}

function validateAiShape(ai) {
  assertHealth(ai && typeof ai === 'object', 'AI layer did not return an object.');
  assertHealth(Number.isFinite(ai.adjusted_score) && ai.adjusted_score >= 0 && ai.adjusted_score <= 100, 'AI adjusted_score invalid.');
  assertHealth(Number.isFinite(ai.confidence) && ai.confidence >= 0 && ai.confidence <= 100, 'AI confidence invalid.');
  assertHealth(typeof ai.should_apply === 'boolean', 'AI should_apply must be boolean.');
  assertHealth(typeof ai.reasoning === 'string', 'AI reasoning must be a string.');
  assertHealth(ai.application_answers && typeof ai.application_answers === 'object', 'AI application_answers invalid.');
}

function validateOptimizerShape(optimizer) {
  assertHealth(optimizer && typeof optimizer === 'object', 'Optimizer did not return an object.');
  for (const key of ['application_score', 'ats_score', 'interview_probability']) {
    assertHealth(Number.isFinite(optimizer[key]) && optimizer[key] >= 0 && optimizer[key] <= 100, `${key} invalid.`);
  }
  assertHealth(['apply', 'review', 'skip'].includes(optimizer.recommendation), 'Optimizer recommendation invalid.');
  assertHealth(typeof optimizer.optimized_cover_letter === 'string', 'Optimizer cover letter missing.');
  assertHealth(optimizer.improved_answers && typeof optimizer.improved_answers === 'object', 'Optimizer answers missing.');
  assertHealth(optimizer.ats_analysis && typeof optimizer.ats_analysis === 'object', 'Optimizer ATS analysis missing.');
}

async function runHealthCheck(checks, name, task) {
  const startedAt = new Date().toISOString();
  try {
    const details = await task();
    checks.push({
      name,
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      details
    });
  } catch (error) {
    checks.push({
      name,
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.stack || error.message
    });
  }
}

function summarizeHealth(checks) {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

function assertHealth(condition, message) {
  if (!condition) throw new Error(message);
}

async function readReviewQueueSize(filePath) {
  try {
    const queue = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(queue) ? queue.length : 0;
  } catch {
    return 0;
  }
}

async function resetOutputDirectory(rootDir, targetDir) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetDir);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to reset directory outside workspace: ${target}`);
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function step(stage, message) {
  return {
    stage,
    message,
    at: new Date().toISOString()
  };
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
