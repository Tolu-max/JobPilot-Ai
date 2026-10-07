import 'dotenv/config';
import { buildConfig } from '../src/config.js';
import { scrapeBruntWorkJobs } from '../src/scrapers/bruntwork.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';
import { attemptApplication } from '../src/automation.js';
import { hasAvailableAiProvider } from '../src/aiRouter.js';
import { loadJobStore } from '../src/jobStore.js';

const args = parseArgs(process.argv.slice(2));
const profileName = String(args.profile || 'tolu');
const targetUrl = String(args.url || 'https://bruntworkcareers.co/jobs/56690873940');
const targetTitle = String(args.title || 'Shopify E-commerce Web Developer');

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
config.autoApply = false;
config.noRealSubmission = true;
config.testMode = false;
config.maxAutoApplyPerRun = 0;
config.headless = parseBoolean(args.headless, config.headless);
config.geminiMinLocalScore = 0;
config.sites = {
  bruntwork: {
    ...(config.sites?.bruntwork || {}),
    enabled: true,
    cooldownMinutes: 0,
    maxJobsPerRun: 25,
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

console.log(`[dry-run:tolu] Profile: ${config.profileName}`);
console.log(`[dry-run:tolu] Preferred provider: ${config.aiProvider}`);
console.log(`[dry-run:tolu] AI provider available: ${hasAvailableAiProvider(config) ? 'yes' : 'no'}`);
console.log(`[dry-run:tolu] Target role: ${targetTitle}`);
console.log(`[dry-run:tolu] Target URL: ${targetUrl}`);
console.log('[dry-run:tolu] Submission guard: NO_REAL_SUBMISSION=true');

const scrapedJobs = await scrapeBruntWorkJobs(config, config.sites.bruntwork);
let job = scrapedJobs.find((item) => item.applicationUrl === targetUrl || item.title === targetTitle);

if (!job) {
  const store = await loadJobStore(config);
  const stored = (store.jobs || []).find((item) => item.job_url === targetUrl || item.title === targetTitle);
  if (stored) {
    job = {
      title: stored.title,
      applicationUrl: stored.job_url || targetUrl,
      source: stored.source_site || 'bruntwork',
      source_site: stored.source_site || 'bruntwork',
      company: stored.company || '',
      description: stored.description || '',
      requirements: stored.requirements || '',
      responsibilities: stored.responsibilities || ''
    };
    console.log('[dry-run:tolu] Loaded target job from stored processedJobs fallback.');
  }
}

if (!job) {
  console.error(`[dry-run:tolu] Could not find target BruntWork job in latest scrape: ${targetTitle}`);
  process.exit(1);
}

console.log(`[dry-run:tolu] Scraped target detail: ${job.title}`);

const localAnalysis = await localMatchJob(job, candidateProfile, config);
console.log(`[dry-run:tolu] Local match score: ${localAnalysis.score} (${localAnalysis.recommendation})`);
console.log(`[dry-run:tolu] Local reasons: ${(localAnalysis.reasons || []).slice(0, 3).join(' | ')}`);

const verification = await verifyJobFit(job, candidateProfile, localAnalysis, config);
console.log(`[dry-run:tolu] AI verification score: ${verification.adjusted_score}`);
console.log(`[dry-run:tolu] AI verification should_apply: ${verification.should_apply}`);
console.log(`[dry-run:tolu] AI verification model: ${verification.model_used || 'unknown'}`);
console.log(`[dry-run:tolu] AI verification reasoning: ${String(verification.reasoning || '').slice(0, 220)}`);

const resumeText = [
  cvData.rawTextPreview,
  candidateProfile.rawTextPreview,
  candidateProfile.resumeTextPreview,
  cvData.summary,
  candidateProfile.summary
].filter(Boolean).join('\n\n');
const optimizer = optimizeApplication({
  job,
  candidateProfile,
  resumeText,
  localAnalysis,
  aiAnalysis: verification
});

const appPackage = {
  optimized_cover_letter: optimizer.optimized_cover_letter || verification.improved_cover_letter || '',
  improved_answers: Object.keys(optimizer.improved_answers || {}).length > 0
    ? optimizer.improved_answers
    : (verification.application_answers || {})
};

console.log(`[dry-run:tolu] Optimizer application score: ${optimizer.application_score}`);
console.log(`[dry-run:tolu] Optimizer ATS score: ${optimizer.ats_score}`);
console.log(`[dry-run:tolu] Optimizer answer keys: ${Object.keys(appPackage.improved_answers || {}).join(', ') || '(none)'}`);

const result = await attemptApplication(
  {
    ...job,
    applicationUrl: `${targetUrl.replace(/\/$/, '')}/apply`
  },
  appPackage,
  config
);

console.log('\n[dry-run:tolu] === RESULT ===');
console.log(`outcome: ${result.outcome}`);
console.log(`reason: ${result.reason}`);
console.log(`lifecycle final state: ${result.lifecycle?.currentState}`);
console.log(`debug dir: ${result.debugDir}`);

if (result.outcome === 'requires_manual_review' && String(result.reason || '').includes('NO_REAL_SUBMISSION')) {
  console.log('\n[dry-run:tolu] PASS: scorer, verifier, and BruntWork form flow reached the no-submit guard.');
  process.exit(0);
}

console.log('\n[dry-run:tolu] FAIL: expected NO_REAL_SUBMISSION manual-review guard.');
process.exit(1);

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

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
