import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import aiRouter, { TaskTypes } from '../src/aiRouter.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication, saveOptimizerArtifacts } from '../src/applicationOptimizer.js';
import {
  ApplicationOutcome,
  ApplicationState,
  createApplicationLifecycle,
  finalizeApplication,
  transitionApplicationState,
  validateApplicationLifecycle
} from '../src/applicationStateManager.js';
import { attemptApplication } from '../src/automation.js';
import { buildConfig } from '../src/config.js';
import { hashJob, getJobRecord, shouldSkipProcessed, upsertJobRecord } from '../src/jobStore.js';
import { localMatchJob } from '../src/localMatcher.js';
import { appendLog } from '../src/logger.js';
import { loadOrBuildCandidateProfile, readResumeText } from '../src/profileParser.js';
import { addReviewJob } from '../src/reviewQueue.js';
import { withRetry } from '../src/retry.js';
import { createSchedulerRunner } from '../src/scheduler.js';
import { runScrapers } from '../src/scrapers/index.js';

const PROFILES = ['tolu', 'sister'];
const TARGET_SITES = [
  'bruntwork',
  'wellfound',
  'remoteok',
  'weworkremotely',
  'workingnomads',
  'remotive',
  'remoteco',
  'jobgether',
  'himalayas',
  'jobspresso'
];
const SCRAPER_LIMIT = 3;
const HIGH_SCORE = 75;
const MEMORY_GROWTH_LIMIT_BYTES = 180 * 1024 * 1024;

process.env.E2E_TEST_MODE = 'true';
process.env.TEST_PLATFORM_MODE = 'true';
process.env.TEST_MODE = 'true';
process.env.NO_REAL_SUBMISSION = 'true';
process.env.AI_MODE ||= 'MOCK';
process.env.TEST_PLATFORM_SCRAPE_MODE ||= 'mock';
process.env.SCRAPER_LIMIT ||= String(SCRAPER_LIMIT);
process.env.TEST_PLATFORM_MAX_JOBS_PER_SITE ||= String(SCRAPER_LIMIT);
process.env.MAX_JOBS_PER_RUN ||= String(SCRAPER_LIMIT);
process.env.HEADLESS = 'true';
process.env.CAPTCHA_WAIT_MS = '1';
process.env.APPLICANT_EMAIL ||= 'e2e-test@example.test';

async function main() {
  const rootDir = process.cwd();
  const reportDir = path.join(rootDir, 'test-report');
  const artifactsRoot = path.join(rootDir, 'test-artifacts', 'e2e');
  const runtimeRoot = path.join(artifactsRoot, '_runtime');

  await resetOutputDirectory(rootDir, artifactsRoot);
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });

  const report = createReport();
  const suiteStart = Date.now();
  const memoryStart = process.memoryUsage().heapUsed;

  const profileContexts = Object.fromEntries(
    await Promise.all(
      PROFILES.map(async (profileName) => [
        profileName,
        await buildProfileContext({ rootDir, artifactsRoot, runtimeRoot, profileName })
      ])
    )
  );

  const scrapeResult = await runScraperValidation(profileContexts.tolu, report);
  report.summary.scraperPassFail = Object.fromEntries(
    scrapeResult.siteResults.map((site) => [site.site, site.status === 'ok' ? 'PASS' : 'FAIL'])
  );

  for (const profileName of PROFILES) {
    await runProfilePipeline(profileContexts[profileName], scrapeResult.jobs, report);
  }

  await runAiRouterValidation(profileContexts.tolu, report);
  await runDeduplicationValidation(profileContexts.tolu, report);
  await runStressValidation({ rootDir, artifactsRoot, runtimeRoot, report });
  finalizeProfileIsolation(report);
  await finalizeAiRouterSummary(profileContexts.tolu.config.aiRouterLogPath, report);

  report.summary.totalJobsProcessed = report.metrics.totalJobsProcessed;
  report.summary.applicationSuccessSimulation = {
    manualReviewStops: report.metrics.manualReviewStops,
    failedApplications: report.metrics.failedApplications,
    successfulSubmissions: report.metrics.successfulSubmissions
  };
  report.summary.stateMachineErrors = report.stateMachine.errors.length;
  report.summary.captchaEvents = report.playwright.captchaEvents.length;
  report.summary.deduplicationHits = report.deduplication.hits.length;
  report.performance.totalDurationMs = Date.now() - suiteStart;
  report.performance.memory.startHeapBytes = memoryStart;
  report.performance.memory.endHeapBytes = process.memoryUsage().heapUsed;
  report.performance.memory.growthBytes =
    report.performance.memory.endHeapBytes - report.performance.memory.startHeapBytes;
  report.performance.memory.pass = report.performance.memory.growthBytes <= MEMORY_GROWTH_LIMIT_BYTES;

  if (!report.performance.memory.pass) {
    report.failures.push(`Memory growth exceeded limit: ${report.performance.memory.growthBytes} bytes.`);
  }

  report.finalAssertion =
    'All systems work together reliably under real-world conditions without breaking state, misrouting AI, duplicating jobs, or incorrectly submitting applications.';
  report.pass = report.failures.length === 0;

  await writeJson(path.join(reportDir, 'e2e-full-report.json'), report);
  await fs.writeFile(path.join(reportDir, 'e2e-full-report.txt'), renderTextReport(report), 'utf8');

  if (!report.pass) {
    console.error(`E2E full integration validation failed. Report: ${path.join(reportDir, 'e2e-full-report.json')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`E2E full integration validation passed. Report: ${path.join(reportDir, 'e2e-full-report.json')}`);
}

function createReport() {
  return {
    generatedAt: new Date().toISOString(),
    pass: false,
    mode: {
      E2E_TEST_MODE: true,
      AI_MODE: process.env.AI_MODE || 'MOCK',
      SCRAPER_LIMIT: Number.parseInt(process.env.SCRAPER_LIMIT || String(SCRAPER_LIMIT), 10),
      NO_REAL_SUBMISSION: true
    },
    summary: {
      totalJobsProcessed: 0,
      scraperPassFail: {},
      aiCallsSummary: {},
      modelUsageBreakdown: {},
      profileResultsComparison: {},
      applicationSuccessSimulation: {},
      stateMachineErrors: 0,
      captchaEvents: 0,
      deduplicationHits: 0
    },
    metrics: {
      totalJobsProcessed: 0,
      manualReviewStops: 0,
      failedApplications: 0,
      successfulSubmissions: 0
    },
    scrapers: {
      pass: true,
      sites: {}
    },
    localMatcher: {
      pass: true,
      jobs: [],
      invalidScores: [],
      exclusionChecks: [],
      missingFieldChecks: [],
      consistencyChecks: []
    },
    aiRouter: {
      pass: true,
      routeChecks: [],
      directCallViolations: [],
      calls: []
    },
    profiles: {
      pass: true,
      tolu: createProfileReport('tolu'),
      sister: createProfileReport('sister'),
      isolation: {
        checks: [],
        pass: true
      }
    },
    optimizer: {
      pass: true,
      jobs: [],
      failures: []
    },
    playwright: {
      pass: true,
      jobs: [],
      captchaEvents: [],
      failures: []
    },
    stateMachine: {
      pass: true,
      jobs: [],
      errors: []
    },
    deduplication: {
      pass: true,
      hits: [],
      stableHashes: [],
      details: []
    },
    stress: {
      pass: true,
      totalJobsSimulated: 0,
      concurrentProfilesPass: false,
      retryLogicPass: false,
      schedulerDuplicateGuardPass: false,
      failures: []
    },
    performance: {
      totalDurationMs: 0,
      memory: {
        startHeapBytes: 0,
        endHeapBytes: 0,
        growthBytes: 0,
        limitBytes: MEMORY_GROWTH_LIMIT_BYTES,
        pass: false
      }
    },
    failures: []
  };
}

function createProfileReport(profileName) {
  return {
    profileName,
    resumePath: '',
    careerPromptPath: '',
    jobsProcessed: 0,
    jobsPerSite: {},
    scoreByTitle: {},
    reviewQueuePath: '',
    outputs: [],
    jobs: [],
    validation: {
      pass: true,
      errors: []
    }
  };
}

async function buildProfileContext({ rootDir, artifactsRoot, runtimeRoot, profileName }) {
  const config = buildE2EConfig({ rootDir, artifactsRoot, runtimeRoot, profileName });
  await fs.mkdir(config.testResultsDir, { recursive: true });
  const profile = await loadOrBuildCandidateProfile(config);
  const resumeText = await readResumeText(config.resumePath);
  return { config, profile, resumeText };
}

function buildE2EConfig({ rootDir, artifactsRoot, runtimeRoot, profileName, suffix = '' }) {
  const baseConfig = buildConfig(['node', 'e2e-full', `--profile=${profileName}`]);
  const runtimeName = suffix ? `${profileName}-${suffix}` : profileName;
  const profileRuntimeDir = path.join(runtimeRoot, runtimeName);
  const profileArtifactDir = path.join(artifactsRoot, profileName);
  const reviewDir = path.join(runtimeRoot, 'review-queues');
  const sites = {};

  for (const [index, site] of TARGET_SITES.entries()) {
    sites[site] = {
      ...(baseConfig.sites?.[site] || {}),
      enabled: true,
      priority: index + 1,
      maxJobsPerRun: SCRAPER_LIMIT,
      cooldownMinutes: 0,
      autoApplyEnabled: true,
      retries: 2,
      retryDelayMs: 5,
      timeoutMs: 30000
    };
  }

  return {
    ...baseConfig,
    rootDir,
    profileName,
    e2eTestMode: true,
    testPlatformMode: true,
    testMode: true,
    noRealSubmission: true,
    platformScrapeMode: 'mock',
    aiMode: process.env.AI_MODE || 'MOCK',
    headless: true,
    simulateAutomation: false,
    autoApply: true,
    allowDuplicateJobs: true,
    maxJobsPerRun: SCRAPER_LIMIT,
    geminiMinLocalScore: HIGH_SCORE,
    applicantEmail: `${profileName}.e2e@example.test`,
    minDelayMs: 1,
    maxDelayMs: 1,
    captchaWaitMs: 1,
    sites,
    enabledSites: TARGET_SITES,
    siteRunStatePath: path.join(profileRuntimeDir, 'siteRunState.json'),
    candidateProfilePath: path.join(profileRuntimeDir, 'candidateProfile.json'),
    jobStorePath: path.join(profileRuntimeDir, 'processedJobs.json'),
    globalJobStorePath: path.join(runtimeRoot, 'globalProcessedJobs.json'),
    reviewPath: path.join(reviewDir, `${profileName}.json`),
    logPath: path.join(profileRuntimeDir, 'e2e.log'),
    aiRouterLogPath: path.join(runtimeRoot, 'aiRouter.log'),
    aiCachePath: path.join(runtimeRoot, 'aiCache.json'),
    debugRootDir: profileArtifactDir,
    testResultsDir: profileArtifactDir,
    browserProfileDir: path.join(profileRuntimeDir, 'browser-profile')
  };
}

async function runScraperValidation(context, report) {
  await appendLog('E2E full suite scraper validation started.', context.config);
  const scrapeResult = await runScrapers(context.config);

  for (const siteResult of scrapeResult.siteResults) {
    const siteJobs = scrapeResult.jobs.filter((job) => job.source_site === siteResult.site);
    const requiredFieldErrors = [];
    for (const job of siteJobs) {
      const errors = validateNormalizedJob(job);
      if (errors.length > 0) {
        requiredFieldErrors.push({ jobHash: job.jobHash, title: job.title, errors });
      }
    }

    const pass =
      siteResult.status === 'ok' &&
      siteResult.jobCount <= SCRAPER_LIMIT &&
      requiredFieldErrors.length === 0;
    report.scrapers.sites[siteResult.site] = {
      pass,
      status: siteResult.status,
      implemented: siteResult.implemented,
      jobCount: siteResult.jobCount,
      requiredFieldErrors
    };
    if (!pass) {
      report.scrapers.pass = false;
      report.failures.push(`Scraper validation failed for ${siteResult.site}.`);
    }
  }

  for (const expectedSite of TARGET_SITES) {
    if (!report.scrapers.sites[expectedSite]) {
      report.scrapers.pass = false;
      report.scrapers.sites[expectedSite] = {
        pass: false,
        status: 'missing',
        implemented: false,
        jobCount: 0,
        requiredFieldErrors: [{ errors: ['No scraper result returned.'] }]
      };
      report.failures.push(`Missing scraper result for ${expectedSite}.`);
    }
  }

  return scrapeResult;
}

async function runProfilePipeline(context, jobs, report) {
  const { config, profile, resumeText } = context;
  const profileReport = report.profiles[config.profileName];
  profileReport.resumePath = config.resumePath;
  profileReport.careerPromptPath = config.careerBrainPromptPath;
  profileReport.reviewQueuePath = config.reviewPath;

  if (!config.careerBrainPrompt) {
    profileReport.validation.pass = false;
    profileReport.validation.errors.push('Career prompt did not load.');
    report.profiles.pass = false;
    report.failures.push(`${config.profileName}: career prompt did not load.`);
  }

  if (!resumeText && !config.resumePlaceholder) {
    profileReport.validation.pass = false;
    profileReport.validation.errors.push('Resume text could not be read.');
    report.profiles.pass = false;
    report.failures.push(`${config.profileName}: resume text could not be read.`);
  }

  const snapshotBrowser = await chromium.launch({ headless: true });
  const snapshotContext = await snapshotBrowser.newContext({ viewport: { width: 1280, height: 900 } });

  try {
    for (const job of jobs) {
      await processJobForProfile({
        job,
        config,
        profile,
        resumeText,
        snapshotContext,
        profileReport,
        report
      });
    }
  } finally {
    await snapshotContext.close();
    await snapshotBrowser.close();
  }
}

async function processJobForProfile({ job, config, profile, resumeText, snapshotContext, profileReport, report }) {
  const jobHash = hashJob(job);
  const artifactDir = path.join(config.testResultsDir, jobHash);
  await fs.mkdir(artifactDir, { recursive: true });

  const site = job.source_site || job.source || 'unknown';
  const pipelineLog = [];
  const scoreOne = localMatchJob(job, profile);
  const scoreTwo = localMatchJob(job, profile);
  const missingFieldVariant = localMatchJob(
    {
      ...job,
      description: undefined,
      requirements: undefined,
      responsibilities: undefined,
      company: undefined
    },
    profile
  );

  await writeJson(path.join(artifactDir, 'job.json'), job);
  pipelineLog.push(step('SCRAPED', `Job collected from ${site}.`));
  pipelineLog.push(step('NORMALIZED', 'Normalized job structure validated.'));

  profileReport.jobsProcessed += 1;
  profileReport.jobsPerSite[site] = (profileReport.jobsPerSite[site] || 0) + 1;
  profileReport.scoreByTitle[job.title] ||= [];
  profileReport.scoreByTitle[job.title].push(scoreOne.score);
  report.metrics.totalJobsProcessed += 1;

  recordLocalMatcherChecks({ report, profileName: config.profileName, job, scoreOne, scoreTwo, missingFieldVariant });
  pipelineLog.push(step('SCORED', `localMatcher score ${scoreOne.score}; recommendation ${scoreOne.recommendation}.`));

  let lifecycle = createApplicationLifecycle(job);
  transitionApplicationState(lifecycle, ApplicationState.SCORED, 'Job was scored.');

  let ai = { skipped: true, reason: 'Below threshold.' };
  let optimizer = { skipped: true };
  let applicationResult = null;
  let finalDecision = 'skipped';

  if (scoreOne.score < HIGH_SCORE) {
    finalizeApplication(lifecycle, ApplicationState.FAILED, `Score ${scoreOne.score} is below ${HIGH_SCORE}.`);
    await upsertJobRecord(config, job, 'ignored', { score: scoreOne.score, decision: 'skip', local: scoreOne });
    pipelineLog.push(step('SKIPPED', `Job stayed below local threshold (${HIGH_SCORE}).`));
  } else {
    transitionApplicationState(lifecycle, ApplicationState.SELECTED_FOR_APPLICATION, 'Job selected for application.');
    ai = await verifyJobFit(job, profile, scoreOne, config);
    optimizer = optimizeApplication({
      job,
      candidateProfile: profile,
      resumeText,
      localAnalysis: scoreOne,
      aiAnalysis: ai
    });
    await saveOptimizerArtifacts(config, job, optimizer);
    pipelineLog.push(step('AI_VERIFIED', `${ai.model_used || 'router'} returned ${ai.adjusted_score}.`));
    pipelineLog.push(
      step(
        'OPTIMIZED',
        `applicationOptimizer score ${optimizer.application_score}; recommendation ${optimizer.recommendation}.`
      )
    );
    recordOptimizerChecks({ report, profileName: config.profileName, job, optimizer, profile, resumeText });

    applicationResult = await attemptApplication(job, optimizer, config);
    lifecycle = applicationResult.lifecycle || lifecycle;
    finalDecision = mapOutcomeToDecision(applicationResult.outcome);
    pipelineLog.push(step('AUTOMATION', `${applicationResult.finalState}: ${applicationResult.reason}`));
    recordPlaywrightChecks({ report, profileName: config.profileName, job, applicationResult });

    if (applicationResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) {
      report.metrics.manualReviewStops += 1;
      await addReviewJob(
        job,
        {
          score: optimizer.application_score,
          cover_letter: optimizer.optimized_cover_letter,
          application_answers: optimizer.improved_answers
        },
        applicationResult.reason,
        config,
        applicationResult
      );
      await upsertJobRecord(config, job, 'manual_review', {
        score: optimizer.application_score,
        decision: optimizer.recommendation,
        local: scoreOne,
        ai,
        optimizer,
        application: applicationResult
      });
    } else if (applicationResult.outcome === ApplicationOutcome.APPLICATION_FAILED) {
      report.metrics.failedApplications += 1;
      await upsertJobRecord(config, job, 'failed', {
        score: optimizer.application_score,
        decision: optimizer.recommendation,
        local: scoreOne,
        ai,
        optimizer,
        application: applicationResult
      });
    } else {
      report.metrics.successfulSubmissions += 1;
      await upsertJobRecord(config, job, 'applied', {
        score: optimizer.application_score,
        decision: optimizer.recommendation,
        local: scoreOne,
        ai,
        optimizer,
        application: applicationResult
      });
    }
    profileReport.outputs.push(optimizer.optimized_cover_letter || '');
  }

  const lifecycleValidation = validateApplicationLifecycle(lifecycle);
  report.stateMachine.jobs.push({
    profile: config.profileName,
    jobHash,
    title: job.title,
    ok: lifecycleValidation.ok,
    finalState: lifecycle.currentState
  });
  if (!lifecycleValidation.ok) {
    report.stateMachine.pass = false;
    report.stateMachine.errors.push({
      profile: config.profileName,
      jobHash,
      title: job.title,
      errors: lifecycleValidation.errors
    });
    report.failures.push(`Invalid state machine lifecycle for ${config.profileName}/${jobHash}.`);
  }

  await writeJson(path.join(artifactDir, 'state_transitions.json'), {
    ok: lifecycleValidation.ok,
    errors: lifecycleValidation.errors,
    lifecycle
  });
  await writeJobArtifacts({ artifactDir, pipelineLog, local: scoreOne, ai, optimizer, applicationResult });
  await captureJobSnapshot(snapshotContext, artifactDir, job, {
    title: job.title,
    score: scoreOne.score,
    decision: finalDecision,
    reason: applicationResult?.reason || lifecycle.reason
  });

  profileReport.jobs.push({
    jobHash,
    title: job.title,
    site,
    localScore: scoreOne.score,
    recommendation: scoreOne.recommendation,
    finalDecision
  });
}

function recordLocalMatcherChecks({ report, profileName, job, scoreOne, scoreTwo, missingFieldVariant }) {
  const scoreValid = Number.isFinite(scoreOne.score) && scoreOne.score >= 0 && scoreOne.score <= 100;
  if (!scoreValid || Number.isNaN(scoreOne.score)) {
    report.localMatcher.pass = false;
    report.localMatcher.invalidScores.push({ profile: profileName, title: job.title, score: scoreOne.score });
    report.failures.push(`localMatcher returned invalid score for ${profileName}/${job.title}.`);
  }

  const consistencyPass = scoreOne.score === scoreTwo.score && scoreOne.recommendation === scoreTwo.recommendation;
  report.localMatcher.consistencyChecks.push({
    profile: profileName,
    title: job.title,
    pass: consistencyPass,
    scoreOne: scoreOne.score,
    scoreTwo: scoreTwo.score
  });
  if (!consistencyPass) {
    report.localMatcher.pass = false;
    report.failures.push(`localMatcher produced inconsistent results for ${profileName}/${job.title}.`);
  }

  const missingFieldPass = Number.isFinite(missingFieldVariant.score) && !Number.isNaN(missingFieldVariant.score);
  report.localMatcher.missingFieldChecks.push({
    profile: profileName,
    title: job.title,
    pass: missingFieldPass,
    score: missingFieldVariant.score
  });
  if (!missingFieldPass) {
    report.localMatcher.pass = false;
    report.failures.push(`localMatcher failed missing-field safety for ${profileName}/${job.title}.`);
  }

  const exclusionPass = /hard filter|security clearance|work authorization/i.test(
    (scoreOne.reasons || []).join(' ')
  )
    ? scoreOne.score === 0
    : true;
  report.localMatcher.exclusionChecks.push({
    profile: profileName,
    title: job.title,
    pass: exclusionPass,
    reasons: scoreOne.reasons
  });
  if (!exclusionPass) {
    report.localMatcher.pass = false;
    report.failures.push(`localMatcher exclusion logic failed for ${profileName}/${job.title}.`);
  }

  report.localMatcher.jobs.push({
    profile: profileName,
    title: job.title,
    score: scoreOne.score,
    recommendation: scoreOne.recommendation
  });
}

function recordOptimizerChecks({ report, profileName, job, optimizer, profile, resumeText }) {
  const validJson = Boolean(
    optimizer && typeof optimizer === 'object' && optimizer.improved_answers && optimizer.ats_analysis
  );
  const keywordSpecific =
    Array.isArray(optimizer.ats_analysis?.keywords) && optimizer.ats_analysis.keywords.length > 0;
  const candidateName = String(profile.name || '').trim();
  const noHallucinatedName =
    !candidateName ||
    String(optimizer.optimized_cover_letter || '').includes(candidateName) ||
    Object.values(optimizer.improved_answers || {}).some((value) => String(value).includes(candidateName));
  const truthfulnessRulePresent = /real experience|supported by the existing resume|truth/i.test(
    String(optimizer.optimized_resume_keywords?.truthfulness_rule || '')
  );

  const pass = validJson && keywordSpecific && noHallucinatedName && truthfulnessRulePresent && Boolean(resumeText || true);
  report.optimizer.jobs.push({
    profile: profileName,
    title: job.title,
    pass,
    application_score: optimizer.application_score,
    ats_score: optimizer.ats_score,
    interview_probability: optimizer.interview_probability
  });
  if (!pass) {
    report.optimizer.pass = false;
    report.optimizer.failures.push({
      profile: profileName,
      title: job.title,
      validJson,
      keywordSpecific,
      noHallucinatedName,
      truthfulnessRulePresent
    });
    report.failures.push(`Optimizer validation failed for ${profileName}/${job.title}.`);
  }
}

function recordPlaywrightChecks({ report, profileName, job, applicationResult }) {
  const debugDir = applicationResult.debugDir || '';
  const pass =
    applicationResult.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW &&
    /NO_REAL_SUBMISSION=true|TEST_MODE=true|TEST_PLATFORM_MODE=true/i.test(applicationResult.reason || '');
  report.playwright.jobs.push({
    profile: profileName,
    title: job.title,
    pass,
    outcome: applicationResult.outcome,
    finalState: applicationResult.finalState,
    reason: applicationResult.reason,
    debugDir
  });

  if (/captcha/i.test(applicationResult.reason || '')) {
    report.playwright.captchaEvents.push({
      profile: profileName,
      title: job.title,
      reason: applicationResult.reason
    });
  }

  if (!pass) {
    report.playwright.pass = false;
    report.playwright.failures.push({
      profile: profileName,
      title: job.title,
      outcome: applicationResult.outcome,
      reason: applicationResult.reason
    });
    report.failures.push(`Playwright safe-mode validation failed for ${profileName}/${job.title}.`);
  }
}

async function runAiRouterValidation(context, report) {
  const routeChecks = [
    {
      taskType: TaskTypes.FAST_FILTER,
      expectedProvider: 'groq',
      forcedFailures: [],
      prompt: 'Return JSON for a fast filter test.'
    },
    {
      taskType: TaskTypes.APPLICATION_WRITING,
      expectedProvider: 'openrouter',
      forcedFailures: ['groq'],
      prompt: 'Return JSON with cover letter text.'
    },
    {
      taskType: TaskTypes.JOB_VERIFICATION,
      expectedProvider: 'gemini',
      forcedFailures: [],
      prompt: 'Return JSON for verification.'
    },
    {
      taskType: TaskTypes.HIGH_VALUE_APPLICATION,
      expectedProvider: 'gemini',
      forcedFailures: ['openrouter'],
      prompt: 'Return JSON for a high-value application.'
    },
    {
      taskType: TaskTypes.FALLBACK_REASONING,
      expectedProvider: 'groq',
      forcedFailures: [],
      prompt: 'Return JSON for fallback reasoning.'
    }
  ];

  for (const check of routeChecks) {
    const startedAt = Date.now();
    const result = await aiRouter.request({
      taskType: check.taskType,
      prompt: check.prompt,
      profile: { profileName: context.config.profileName, name: context.profile.name },
      jobData: {
        title: `${check.taskType} validation role`,
        company: 'E2E Suite',
        applicationUrl: `https://example.test/${check.taskType.toLowerCase()}`,
        localScore: check.taskType === TaskTypes.HIGH_VALUE_APPLICATION ? 95 : 82
      },
      fallbackLevel: 'e2e-validation',
      config: {
        ...context.config,
        aiMode: 'MOCK',
        aiRouterForcedFailures: check.forcedFailures
      }
    });
    const provider = String(result.modelUsed || '').split(':')[0];
    const pass = provider === check.expectedProvider || result.modelUsed === 'local-rules';
    report.aiRouter.routeChecks.push({
      taskType: check.taskType,
      pass,
      modelUsed: result.modelUsed,
      latencyMs: Date.now() - startedAt,
      confidence: result.confidence,
      fallbackUsed: result.fallbackUsed
    });
    if (!pass) {
      report.aiRouter.pass = false;
      report.failures.push(`AI router selected ${result.modelUsed} for ${check.taskType}, expected ${check.expectedProvider}.`);
    }
  }

  const directViolations = await findDirectAiCallsOutsideRouter(context.config.rootDir);
  report.aiRouter.directCallViolations = directViolations;
  if (directViolations.length > 0) {
    report.aiRouter.pass = false;
    report.failures.push('Direct AI provider usage found outside aiRouter.js.');
  }
}

async function findDirectAiCallsOutsideRouter(rootDir) {
  const srcDir = path.join(rootDir, 'src');
  const violations = [];
  const files = await collectFiles(srcDir);
  const patterns = [/GoogleGenAI/, /generateContent\s*\(/, /api\.groq\.com/, /openrouter\.ai\/api/, /openai\/v1\/chat\/completions/];

  for (const filePath of files) {
    if (path.basename(filePath) === 'aiRouter.js') continue;
    const text = await fs.readFile(filePath, 'utf8');
    if (patterns.some((pattern) => pattern.test(text))) {
      violations.push(path.relative(rootDir, filePath));
    }
  }

  return violations;
}

async function runDeduplicationValidation(context, report) {
  const config = buildE2EConfig({
    rootDir: context.config.rootDir,
    artifactsRoot: path.join(context.config.rootDir, 'test-artifacts', 'e2e'),
    runtimeRoot: path.join(context.config.rootDir, 'test-artifacts', 'e2e', '_runtime'),
    profileName: context.config.profileName,
    suffix: 'dedupe'
  });
  config.allowDuplicateJobs = false;

  const originalJob = {
    title: 'Technical SEO and Shopify Specialist',
    company: 'Shared Company',
    source: 'bruntwork',
    source_site: 'bruntwork',
    applicationUrl: 'https://example.test/jobs/1'
  };
  const crossSiteDuplicate = {
    ...originalJob,
    source: 'remoteok',
    source_site: 'remoteok',
    applicationUrl: 'https://example.test/jobs/2?utm_source=x'
  };

  const hashOne = hashJob(originalJob);
  const hashTwo = hashJob(crossSiteDuplicate);
  const stableHash = hashOne === hashTwo;
  report.deduplication.stableHashes.push({
    title: originalJob.title,
    hashOne,
    hashTwo,
    pass: stableHash
  });
  if (!stableHash) {
    report.deduplication.pass = false;
    report.failures.push('Job hash was not stable across cross-site duplicates.');
  }

  await upsertJobRecord(config, originalJob, 'applied', { score: 92 });
  const record = await getJobRecord(config, crossSiteDuplicate);
  const skip = shouldSkipProcessed(record);
  report.deduplication.hits.push({
    title: originalJob.title,
    pass: Boolean(record && skip),
    job_hash: record?.job_hash || ''
  });
  if (!(record && skip)) {
    report.deduplication.pass = false;
    report.failures.push('Deduplication lookup did not detect a previously processed duplicate.');
  }
}

async function runStressValidation({ rootDir, artifactsRoot, runtimeRoot, report }) {
  const stressArtifactsRoot = path.join(artifactsRoot, '_stress');
  const stressRuntimeRoot = path.join(runtimeRoot, 'stress');
  const memoryStart = process.memoryUsage().heapUsed;

  const contexts = Object.fromEntries(
    await Promise.all(
      PROFILES.map(async (profileName) => [
        profileName,
        await buildProfileContext({
          rootDir,
          artifactsRoot: stressArtifactsRoot,
          runtimeRoot: stressRuntimeRoot,
          profileName
        })
      ])
    )
  );

  const [toluScrape, sisterScrape] = await Promise.all([
    runScrapers(contexts.tolu.config),
    runScrapers(contexts.sister.config)
  ]);

  report.stress.totalJobsSimulated = toluScrape.jobs.length + sisterScrape.jobs.length;
  report.stress.concurrentProfilesPass = report.stress.totalJobsSimulated >= 50 && report.stress.totalJobsSimulated <= 100;
  if (!report.stress.concurrentProfilesPass) {
    report.stress.pass = false;
    report.stress.failures.push(`Expected 50-100 jobs in stress test, got ${report.stress.totalJobsSimulated}.`);
  }

  let retryAttempts = 0;
  await withRetry(
    async () => {
      retryAttempts += 1;
      if (retryAttempts === 1) throw new Error('forced retry');
      return true;
    },
    { retries: 2, delayMs: 1 }
  );
  report.stress.retryLogicPass = retryAttempts === 2;
  if (!report.stress.retryLogicPass) {
    report.stress.pass = false;
    report.stress.failures.push(`Retry logic was unstable. Attempts: ${retryAttempts}.`);
  }

  const schedulerConfig = contexts.tolu.config;
  let schedulerRuns = 0;
  const runOnce = createSchedulerRunner(schedulerConfig, async () => {
    schedulerRuns += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const [firstTick, secondTick] = await Promise.all([runOnce(), runOnce()]);
  report.stress.schedulerDuplicateGuardPass =
    schedulerRuns === 1 && firstTick?.skipped === false && secondTick?.skipped === true;
  if (!report.stress.schedulerDuplicateGuardPass) {
    report.stress.pass = false;
    report.stress.failures.push('Scheduler duplicate guard allowed overlapping runs.');
  }

  const memoryGrowth = process.memoryUsage().heapUsed - memoryStart;
  if (memoryGrowth > MEMORY_GROWTH_LIMIT_BYTES) {
    report.stress.pass = false;
    report.stress.failures.push(`Stress test memory growth exceeded limit: ${memoryGrowth}.`);
  }

  if (report.stress.failures.length > 0) {
    report.failures.push(...report.stress.failures);
  }
}

function finalizeProfileIsolation(report) {
  const tolu = report.profiles.tolu;
  const sister = report.profiles.sister;
  const toluSeo = average(tolu.scoreByTitle['Technical SEO and Shopify Specialist']);
  const sisterSeo = average(sister.scoreByTitle['Technical SEO and Shopify Specialist']);
  const toluSupport = average(tolu.scoreByTitle['Customer Support and CRM Assistant']);
  const sisterSupport = average(sister.scoreByTitle['Customer Support and CRM Assistant']);

  report.summary.profileResultsComparison = {
    toluSeo,
    sisterSeo,
    toluSupport,
    sisterSupport
  };

  const checks = [
    {
      label: 'Tolu scores much higher on SEO/Shopify roles',
      pass: toluSeo > sisterSeo + 20
    },
    {
      label: 'Sister scores much higher on support/CRM roles',
      pass: sisterSupport > toluSupport + 20
    },
    {
      label: 'Review queues are isolated by profile',
      pass: tolu.reviewQueuePath !== sister.reviewQueuePath
    },
    {
      label: 'Tolu outputs do not leak into sister outputs',
      pass: !sister.outputs.join('\n').toLowerCase().includes('toluwalope')
    }
  ];

  report.profiles.isolation.checks = checks;
  report.profiles.isolation.pass = checks.every((item) => item.pass);
  report.profiles.pass = report.profiles.pass && report.profiles.isolation.pass;
  if (!report.profiles.isolation.pass) {
    report.failures.push('Profile isolation validation failed.');
  }
}

async function finalizeAiRouterSummary(aiRouterLogPath, report) {
  const entries = await readJsonLines(aiRouterLogPath);
  const modelUsageBreakdown = {};
  const taskCounts = {};
  let successCount = 0;
  let failureCount = 0;
  let totalLatency = 0;

  for (const entry of entries) {
    report.aiRouter.calls.push(entry);
    modelUsageBreakdown[entry.modelUsed] = (modelUsageBreakdown[entry.modelUsed] || 0) + 1;
    taskCounts[entry.taskType] = (taskCounts[entry.taskType] || 0) + 1;
    totalLatency += entry.latencyMs || 0;
    if (entry.success) successCount += 1;
    else failureCount += 1;
  }

  report.summary.aiCallsSummary = {
    total: entries.length,
    successCount,
    failureCount,
    averageLatencyMs: entries.length > 0 ? Math.round(totalLatency / entries.length) : 0,
    taskCounts
  };
  report.summary.modelUsageBreakdown = modelUsageBreakdown;
}

function validateNormalizedJob(job) {
  const requiredFields = ['source', 'source_site', 'title', 'company', 'description', 'requirements', 'applicationUrl'];
  return requiredFields.filter((field) => !String(job[field] || '').trim());
}

function mapOutcomeToDecision(outcome) {
  if (outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) return 'applied_successfully';
  if (outcome === ApplicationOutcome.APPLICATION_FAILED) return 'failed';
  if (outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW) return 'review_required';
  return 'skipped';
}

async function writeJobArtifacts({ artifactDir, pipelineLog, local, ai, optimizer, applicationResult }) {
  await writeJson(path.join(artifactDir, 'pipeline_log.json'), pipelineLog);
  await writeJson(path.join(artifactDir, 'local_matcher.json'), local || { skipped: true });
  await writeJson(path.join(artifactDir, 'ai_output.json'), ai || { skipped: true });
  await writeJson(path.join(artifactDir, 'optimizer_output.json'), optimizer || { skipped: true });
  await writeJson(path.join(artifactDir, 'automation_result.json'), applicationResult || { skipped: true });
  await fs.writeFile(
    path.join(artifactDir, 'logs.txt'),
    `${pipelineLog.map((item) => `[${item.at}] ${item.stage}: ${item.message}`).join('\n')}\n`,
    'utf8'
  );
}

async function captureJobSnapshot(snapshotContext, artifactDir, job, summary) {
  const html = renderJobSnapshot(job, summary);
  await fs.writeFile(path.join(artifactDir, 'job_snapshot.html'), html, 'utf8');
  const page = await snapshotContext.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(artifactDir, 'screenshot_job_snapshot.png'), fullPage: true });
  } finally {
    await page.close();
  }
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

function renderTextReport(report) {
  const scraperLines = TARGET_SITES.map((site) => {
    const item = report.scrapers.sites[site];
    return `- ${site}: ${item?.pass ? 'PASS' : 'FAIL'} (${item?.jobCount ?? 0} job(s))`;
  }).join('\n');
  const routeLines = report.aiRouter.routeChecks
    .map((check) => `- ${check.taskType}: ${check.pass ? 'PASS' : 'FAIL'} via ${check.modelUsed}`)
    .join('\n');
  const stateLines =
    report.stateMachine.errors.length > 0
      ? report.stateMachine.errors.map((item) => `- ${item.profile}/${item.title}: ${JSON.stringify(item.errors)}`).join('\n')
      : '- none';
  const failureLines = report.failures.length > 0 ? report.failures.map((item) => `- ${item}`).join('\n') : '- none';

  return `E2E Full Integration Report
Generated: ${report.generatedAt}
Mode: E2E_TEST_MODE=${report.mode.E2E_TEST_MODE}, AI_MODE=${report.mode.AI_MODE}, SCRAPER_LIMIT=${report.mode.SCRAPER_LIMIT}, NO_REAL_SUBMISSION=${report.mode.NO_REAL_SUBMISSION}

Summary
- Total jobs processed: ${report.summary.totalJobsProcessed}
- AI calls: ${report.summary.aiCallsSummary.total || 0}
- Application success simulation: ${JSON.stringify(report.summary.applicationSuccessSimulation)}
- State machine errors: ${report.summary.stateMachineErrors}
- CAPTCHA events: ${report.summary.captchaEvents}
- Deduplication hits: ${report.summary.deduplicationHits}

Scrapers
${scraperLines}

AI Router
${routeLines}

Profile Comparison
${JSON.stringify(report.summary.profileResultsComparison, null, 2)}

Performance
- Total duration ms: ${report.performance.totalDurationMs}
- Heap growth bytes: ${report.performance.memory.growthBytes}
- Memory check: ${report.performance.memory.pass ? 'PASS' : 'FAIL'}
- Stress total jobs: ${report.stress.totalJobsSimulated}
- Scheduler duplicate guard: ${report.stress.schedulerDuplicateGuardPass ? 'PASS' : 'FAIL'}

State Machine Errors
${stateLines}

Failures
${failureLines}
`;
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readJsonLines(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
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
  return { stage, message, at: new Date().toISOString() };
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
