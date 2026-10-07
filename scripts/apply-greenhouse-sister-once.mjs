import 'dotenv/config';
import { buildConfig } from '../src/config.js';
import { scrapeGreenhouseJobs } from '../src/scrapers/greenhouse.js';
import { loadOrBuildCandidateProfile, readResumeText } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';
import { attemptApplication } from '../src/automation.js';
import { ApplicationOutcome } from '../src/applicationStateManager.js';
import { upsertJobRecord } from '../src/jobStore.js';

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

const argv = ['node', 'apply-greenhouse-sister-once', '--profile=sister'];
const config = buildConfig(argv);
config.noRealSubmission = false;
config.testMode = false;
config.headless = String(process.env.HEADLESS || '').toLowerCase() === 'false' ? false : config.headless;
config.applicationTimeoutMs = Number.parseInt(process.env.APPLICATION_TIMEOUT_MS || '600000', 10);
config.captchaWaitMs = Number.parseInt(process.env.CAPTCHA_WAIT_MS || '600000', 10);
config.sites.greenhouse = {
  ...(config.sites.greenhouse || {}),
  enabled: true,
  autoApplyEnabled: false,
  remoteOnly: true,
  maxJobsPerRun: Number.parseInt(process.env.SISTER_GREENHOUSE_MAX_JOBS_PER_RUN || '20', 10),
  boards: parseList(argValue('boards') || process.env.GREENHOUSE_QA_BOARDS || process.env.SISTER_GREENHOUSE_BOARDS || 'remote,webflow,gitlab,customerio,calendly,typeform,canonical,asana')
};

if (!config.deepseekApiKey) {
  throw new Error('DeepSeek key is missing. Refusing to apply from local-rule fallback.');
}

const profile = await loadOrBuildCandidateProfile(config);
config.candidateProfile = profile;
config.cvData = await loadCvData(config);
const resumeText = await readResumeText(config.resumePath);
const jobs = await scrapeGreenhouseJobs(config, config.sites.greenhouse);

console.log(`[greenhouse:sister] Scraped ${jobs.length} Greenhouse candidate(s).`);

const candidates = [];
for (const job of jobs) {
  const local = await localMatchJob(job, profile, config);
  if (local.score < 40) {
    console.log(`[greenhouse:sister] IGNORE local ${local.score}: ${job.title} - ${job.company}`);
    continue;
  }

  const verification = await verifyJobFit(job, profile, local, config);
  const optimizer = optimizeApplication({
    job,
    candidateProfile: profile,
    resumeText,
    localAnalysis: local,
    aiAnalysis: verification
  });
  const highRisk = (optimizer.risk_flags || []).some((flag) => flag.severity === 'high');
  const approved =
    verification.should_apply === true &&
    Number(verification.adjusted_score) >= 65 &&
    Number(optimizer.application_score) >= 65 &&
    !verification.ai_router?.fallbackUsed &&
    verification.ai_router?.modelUsed !== 'local-rules' &&
    !highRisk;

  console.log(
    `[greenhouse:sister] ${approved ? 'APPROVED' : 'REVIEW'} local=${local.score} ai=${verification.adjusted_score} app=${optimizer.application_score} model=${verification.model_used || 'unknown'} fallback=${verification.ai_router?.fallbackUsed ? 'yes' : 'no'}: ${job.title} - ${job.company}`
  );
  console.log(`[greenhouse:sister] Reason: ${String(verification.reasoning || '').replace(/\s+/g, ' ').trim().slice(0, 500)}`);

  await upsertJobRecord(config, job, approved ? 'pending_apply' : 'reviewed', {
    score: optimizer.application_score,
    decision: approved ? 'apply' : 'review',
    local,
    gemini: verification,
    optimizer,
    reason: approved ? 'DeepSeek approved one-time Greenhouse live attempt.' : verification.reasoning
  });

  if (approved) candidates.push({ job, local, verification, optimizer });
}

const target = candidates.sort((a, b) => b.optimizer.application_score - a.optimizer.application_score)[0];
if (!target) {
  console.log('[greenhouse:sister] No Greenhouse role passed real DeepSeek approval. No application attempted.');
  process.exit(0);
}

console.log(`[greenhouse:sister] LIVE attempt: ${target.job.title} - ${target.job.company}`);
const result = await attemptApplication(target.job, target.optimizer, config);
console.log(JSON.stringify({
  outcome: result.outcome,
  finalState: result.finalState,
  reason: result.reason,
  debugDir: result.debugDir
}, null, 2));

const nextStatus = result.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY
  ? 'applied'
  : result.outcome === ApplicationOutcome.REQUIRES_MANUAL_REVIEW
    ? 'manual_review'
    : 'failed';

await upsertJobRecord(config, target.job, nextStatus, {
  score: target.optimizer.application_score,
  decision: 'apply',
  local: target.local,
  gemini: target.verification,
  optimizer: target.optimizer,
  reason: result.reason,
  application: result,
  appliedAt: result.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY ? new Date().toISOString() : undefined
});
