import 'dotenv/config';
import fs from 'node:fs/promises';
import { buildConfig } from '../src/config.js';
import { scrapeBruntWorkJobs } from '../src/scrapers/bruntwork.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';
import { attemptApplication } from '../src/automation.js';
import { ApplicationOutcome } from '../src/applicationStateManager.js';
import { getGlobalJobRecord, getJobRecord, upsertGlobalJobRecord, upsertJobRecord } from '../src/jobStore.js';

const args = parseArgs(process.argv.slice(2));
const auditPath = args.audit || 'audit/profile-role-qa/bruntwork-tolu-2026-06-06T18-46-15-670Z.json';
const maxApplies = positiveInt(args['max-applies'] || args.maxApplies, 1);
const profileName = String(args.profile || 'tolu');
const forceReviewed = parseBoolean(args.forceReviewed || args['force-reviewed'] || args.force, false);
const minLocalScore = positiveInt(args.minLocalScore || args['min-local-score'], 70);

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
config.autoApply = true;
config.noRealSubmission = false;
config.testMode = false;
config.maxAutoApplyPerRun = maxApplies;
config.geminiMinLocalScore = Math.min(config.geminiMinLocalScore || 60, 60);
config.sites = {
  bruntwork: {
    ...(config.sites?.bruntwork || {}),
    enabled: true,
    autoApplyEnabled: true,
    cooldownMinutes: 0,
    maxJobsPerRun: 200,
    includeKeywords: [],
    includeTitleKeywords: [],
    excludeKeywords: []
  }
};
config.enabledSites = ['bruntwork'];

const candidateProfile = await loadOrBuildCandidateProfile(config);
config.candidateProfile = candidateProfile;
const cvData = await loadCvData(config);
config.cvData = cvData;
config.applicantEmail = cvData.email || config.applicantEmail;

const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
const candidates = (audit.wouldAdvance || [])
  .filter((row) => row.url && ['review', 'auto_apply', 'instant_apply'].includes(row.recommendation))
  .slice(0, 20);

console.log(`[apply-audit:${profileName}] Audit: ${auditPath}`);
console.log(`[apply-audit:${profileName}] Candidates: ${candidates.length}`);
console.log(`[apply-audit:${profileName}] Max live applies: ${maxApplies}`);
console.log(`[apply-audit:${profileName}] Force reviewed candidates: ${forceReviewed}`);
console.log(`[apply-audit:${profileName}] Min local score: ${minLocalScore}`);
console.log(`[apply-audit:${profileName}] NO_REAL_SUBMISSION=false`);

let scrapedJobs = [];
try {
  scrapedJobs = await scrapeBruntWorkJobs(config, config.sites.bruntwork);
} catch (error) {
  console.warn(`[apply-audit:${profileName}] BruntWork scrape failed; falling back to audited job URLs: ${error.message}`);
}
const jobsByUrl = new Map(scrapedJobs.map((job) => [job.applicationUrl, job]));
const resumeText = [
  cvData.rawTextPreview,
  candidateProfile.rawTextPreview,
  candidateProfile.resumeTextPreview,
  cvData.summary,
  candidateProfile.summary
].filter(Boolean).join('\n\n');

let liveAttempts = 0;
let applied = 0;
let manualReview = 0;
let skipped = 0;

for (const candidate of candidates) {
  if (liveAttempts >= maxApplies) {
    console.log(`[apply-audit:${profileName}] Budget reached; holding remaining candidate: ${candidate.title}`);
    break;
  }

  const job = jobsByUrl.get(candidate.url) || buildJobFromAudit(candidate);
  const localRecord = await getJobRecord(config, { applicationUrl: job.applicationUrl });
  const globalRecord = await getGlobalJobRecord(config, { applicationUrl: job.applicationUrl });

  if (localRecord?.status === 'applied' || globalRecord?.status === 'applied') {
    console.log(`[apply-audit:${profileName}] SKIP already applied: ${job.title}`);
    skipped += 1;
    continue;
  }

  console.log(`\n[apply-audit:${profileName}] Checking: ${job.title}`);
  const local = await localMatchJob(job, candidateProfile, config);
  console.log(`[apply-audit:${profileName}] Local: ${local.score} ${local.recommendation}`);
  if (local.score < minLocalScore) {
    console.log(`[apply-audit:${profileName}] SKIP local score below ${minLocalScore}.`);
    skipped += 1;
    continue;
  }

  const verification = await verifyJobFit(job, candidateProfile, local, config);
  console.log(`[apply-audit:${profileName}] Verification: ${verification.adjusted_score}, should_apply=${verification.should_apply}, model=${verification.model_used || 'unknown'}`);
  if (verification.should_apply !== true || Number(verification.adjusted_score) < 70) {
    if (!forceReviewed) {
      console.log(`[apply-audit:${profileName}] REVIEW only: ${verification.reasoning}`);
      await upsertJobRecord(config, job, 'reviewed', {
        score: local.score,
        decision: 'review',
        local,
        gemini: verification,
        reason: 'AI verification did not approve live submission.'
      });
      skipped += 1;
      continue;
    }
    console.log(`[apply-audit:${profileName}] FORCE APPLY: user-approved BruntWork review candidate despite AI verifier: ${verification.reasoning}`);
  }

  const optimizer = optimizeApplication({
    job,
    candidateProfile,
    resumeText,
    localAnalysis: local,
    aiAnalysis: verification
  });
  console.log(`[apply-audit:${profileName}] Optimizer: app=${optimizer.application_score}, ats=${optimizer.ats_score}, rec=${optimizer.recommendation}`);

  const highRisk = (optimizer.risk_flags || []).some((flag) => flag.severity === 'high');
  if (highRisk || (!forceReviewed && Number(optimizer.application_score) < 70)) {
    console.log(`[apply-audit:${profileName}] REVIEW only: optimizer risk/score gate failed.`);
    skipped += 1;
    continue;
  }
  if (forceReviewed && Number(optimizer.application_score) < 70) {
    console.log(`[apply-audit:${profileName}] FORCE APPLY: optimizer score ${optimizer.application_score} is below 70, but no high-risk flag was found.`);
  }

  const applyJob = {
    ...job,
    applicationUrl: `${String(job.applicationUrl).replace(/\/apply\/?$/, '').replace(/\/$/, '')}/apply`
  };

  liveAttempts += 1;
  console.log(`[apply-audit:${profileName}] LIVE attempt ${liveAttempts}/${maxApplies}: ${applyJob.applicationUrl}`);
  const result = await attemptApplication(applyJob, optimizer, config);
  console.log(`[apply-audit:${profileName}] Result: ${result.outcome} - ${result.reason}`);

  const recordDetails = {
    score: optimizer.application_score,
    decision: 'apply',
    local,
    gemini: verification,
    optimizer,
    application: result,
    userApprovedOverride: forceReviewed
  };

  if (result.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
    applied += 1;
    await upsertJobRecord(config, job, 'applied', {
      ...recordDetails,
      appliedAt: new Date().toISOString()
    });
    await upsertGlobalJobRecord(config, job, 'applied', {
      ...recordDetails,
      appliedAt: new Date().toISOString()
    });
  } else {
    manualReview += 1;
    await upsertJobRecord(config, job, result.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW ? 'manual_review' : 'failed', {
      ...recordDetails,
      reason: result.reason
    });
  }
}

console.log(`\n[apply-audit:${profileName}] === SUMMARY ===`);
console.log(`liveAttempts: ${liveAttempts}`);
console.log(`applied: ${applied}`);
console.log(`manualReviewOrFailed: ${manualReview}`);
console.log(`skipped: ${skipped}`);

function buildJobFromAudit(row) {
  return {
    title: row.title,
    applicationUrl: row.url,
    source: 'bruntwork',
    source_site: 'bruntwork',
    company: 'BruntWork',
    description: [...(row.reasons || []), ...(row.matchedSkills || []), ...(row.missingSkills || [])].join('\n'),
    requirements: (row.missingSkills || []).join(', '),
    responsibilities: ''
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    parsed[rawKey] = inlineValue ?? argv[i + 1] ?? true;
    if (inlineValue === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
  }
  return parsed;
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}
