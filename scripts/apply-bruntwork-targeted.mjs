import 'dotenv/config';
import { buildConfig } from '../src/config.js';
import { fetchBruntWorkJobDetail, scrapeBruntWorkJobs } from '../src/scrapers/bruntwork.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';
import { attemptApplication } from '../src/automation.js';
import { ApplicationOutcome } from '../src/applicationStateManager.js';
import { getGlobalJobRecord, getJobRecord, loadJobStore, upsertGlobalJobRecord, upsertJobRecord } from '../src/jobStore.js';

const args = parseArgs(process.argv.slice(2));
const profileName = String(args.profile || 'tolu');
const forceReviewed = parseBoolean(args.forceReviewed || args['force-reviewed'] || false, false);
const headless = parseBoolean(args.headless, true);
const urls = collectUrls(args);

if (urls.length === 0) {
  console.error('Usage: node scripts/apply-bruntwork-targeted.mjs --profile=tolu --url=<apply-url> [--url=<apply-url>]');
  process.exit(1);
}

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
config.autoApply = true;
config.noRealSubmission = false;
config.testMode = false;
config.maxAutoApplyPerRun = urls.length;
config.geminiMinLocalScore = Math.min(config.geminiMinLocalScore || 60, 60);
config.headless = headless;
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

console.log(`[targeted:${profileName}] URLs: ${urls.length}`);
console.log(`[targeted:${profileName}] Force reviewed: ${forceReviewed}`);
console.log(`[targeted:${profileName}] Headless: ${config.headless}`);
console.log('[targeted] NO_REAL_SUBMISSION=false');

let scrapedJobs = [];
if (urls.length === 0) {
  try {
    scrapedJobs = await scrapeBruntWorkJobs(config, config.sites.bruntwork);
  } catch (error) {
    console.warn(`[targeted:${profileName}] BruntWork scrape failed; continuing with direct URLs: ${error.message}`);
  }
} else {
  console.log(`[targeted:${profileName}] Direct URL mode: skipping broad BruntWork scrape.`);
}

const jobsByUrl = new Map();
for (const job of scrapedJobs) {
  jobsByUrl.set(normalizeUrl(job.applicationUrl), job);
  jobsByUrl.set(normalizeUrl(stripApplySuffix(job.applicationUrl)), job);
}

const store = await loadJobStore(config);
for (const item of store.jobs || []) {
  const storedUrl = item.job_url || item.applicationUrl;
  if (!storedUrl) continue;
  jobsByUrl.set(normalizeUrl(storedUrl), {
    title: item.title,
    applicationUrl: storedUrl,
    source: item.source_site || 'bruntwork',
    source_site: item.source_site || 'bruntwork',
    company: item.company || 'BruntWork',
    description: item.description || '',
    requirements: item.requirements || '',
    responsibilities: item.responsibilities || ''
  });
}

const resumeText = [
  cvData.rawTextPreview,
  candidateProfile.rawTextPreview,
  candidateProfile.resumeTextPreview,
  cvData.summary,
  candidateProfile.summary
].filter(Boolean).join('\n\n');

let applied = 0;
let manualReview = 0;
let skipped = 0;

for (const rawUrl of urls) {
  const baseUrl = stripApplySuffix(rawUrl);
  const normalized = normalizeUrl(baseUrl);
  let job = jobsByUrl.get(normalized) || null;
  const localRecord = await getJobRecord(config, { applicationUrl: baseUrl });
  const globalRecord = await getGlobalJobRecord(config, { applicationUrl: baseUrl });
  if (!job || isPlaceholderBruntWorkJob(job)) {
    try {
      job = await fetchBruntWorkJobDetail(config, baseUrl, config.sites.bruntwork);
      jobsByUrl.set(normalized, job);
      console.log(`[targeted:${profileName}] Hydrated live detail for ${baseUrl}: ${job.title}`);
      if (localRecord) {
        const { title, company, source_site, job_hash, job_url, createdAt, updatedAt, ...localDetails } = localRecord;
        await upsertJobRecord(config, job, localRecord.status, {
          ...localDetails
        });
      }
      if (globalRecord) {
        const { title, company, source_site, job_hash, job_url, createdAt, updatedAt, applied_by_profile, ...globalDetails } = globalRecord;
        await upsertGlobalJobRecord(config, job, globalRecord.status, {
          ...globalDetails
        });
      }
    } catch (error) {
      console.warn(`[targeted:${profileName}] Live detail fetch failed for ${baseUrl}: ${error.message}`);
      job = job || buildFallbackJob(baseUrl);
    }
  }

  if (localRecord?.status === 'applied' || globalRecord?.status === 'applied') {
    console.log(`[targeted:${profileName}] SKIP already applied: ${job.title} (${baseUrl})`);
    skipped += 1;
    continue;
  }

  console.log(`\n[targeted:${profileName}] Checking: ${job.title}`);
  console.log(`[targeted:${profileName}] URL: ${baseUrl}`);

  const local = await localMatchJob(job, candidateProfile, config);
  console.log(`[targeted:${profileName}] Local: ${local.score} ${local.recommendation}`);

  const verification = await verifyJobFit(job, candidateProfile, local, config);
  console.log(`[targeted:${profileName}] Verification: ${verification.adjusted_score}, should_apply=${verification.should_apply}, model=${verification.model_used || 'unknown'}`);

  if ((verification.should_apply !== true || Number(verification.adjusted_score) < 70) && !forceReviewed) {
    console.log(`[targeted:${profileName}] REVIEW only: ${verification.reasoning}`);
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

  const optimizer = optimizeApplication({
    job,
    candidateProfile,
    resumeText,
    localAnalysis: local,
    aiAnalysis: verification
  });
  console.log(`[targeted:${profileName}] Optimizer: app=${optimizer.application_score}, ats=${optimizer.ats_score}, rec=${optimizer.recommendation}`);

  const highRisk = (optimizer.risk_flags || []).some((flag) => flag.severity === 'high');
  if (highRisk) {
    if (forceReviewed) {
      console.log(`[targeted:${profileName}] FORCE APPLY: optimizer high-risk flag present but explicit override enabled.`);
    } else {
    console.log(`[targeted:${profileName}] REVIEW only: optimizer high-risk flag present.`);
    skipped += 1;
    continue;
    }
  }

  const applyJob = {
    ...job,
    applicationUrl: `${stripApplySuffix(baseUrl)}/apply`
  };

  console.log(`[targeted:${profileName}] LIVE attempt: ${applyJob.applicationUrl}`);
  const result = await attemptApplication(applyJob, optimizer, config);
  console.log(`[targeted:${profileName}] Result: ${result.outcome} - ${result.reason}`);

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

console.log(`\n[targeted:${profileName}] === SUMMARY ===`);
console.log(`applied: ${applied}`);
console.log(`manualReviewOrFailed: ${manualReview}`);
console.log(`skipped: ${skipped}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue ?? argv[i + 1] ?? true;
    if (rawKey === 'url') {
      parsed.url = parsed.url || [];
      parsed.url.push(value);
    } else {
      parsed[rawKey] = value;
    }
    if (inlineValue === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
  }
  return parsed;
}

function collectUrls(parsed) {
  const raw = parsed.url;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => stripApplySuffix(String(value).trim())).filter(Boolean);
}

function stripApplySuffix(url) {
  return String(url || '').replace(/\/apply\/?$/i, '').replace(/\/$/, '');
}

function normalizeUrl(url) {
  return stripApplySuffix(url).toLowerCase();
}

function buildFallbackJob(url) {
  const id = String(url).split('/').filter(Boolean).at(-1) || 'unknown';
  return {
    title: `BruntWork Role ${id}`,
    applicationUrl: url,
    source: 'bruntwork',
    source_site: 'bruntwork',
    company: 'BruntWork',
    description: '',
    requirements: '',
    responsibilities: ''
  };
}

function isPlaceholderBruntWorkJob(job = {}) {
  return /^BruntWork Role \d+$/i.test(String(job.title || '').trim()) && !String(job.description || '').trim();
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}
