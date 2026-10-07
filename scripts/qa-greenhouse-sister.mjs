import 'dotenv/config';
import { buildConfig } from '../src/config.js';
import { scrapeGreenhouseJobs } from '../src/scrapers/greenhouse.js';
import { loadOrBuildCandidateProfile, readResumeText } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { localMatchJob } from '../src/localMatcher.js';
import { verifyJobFit } from '../src/aiMatcher.js';
import { optimizeApplication } from '../src/applicationOptimizer.js';

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

const defaultBoards = [
  'remote',
  'webflow',
  'gitlab',
  'customerio',
  'calendly',
  'typeform',
  'canonical',
  'asana',
  'airtable',
  'gusto',
  'apolloio',
  'twilio',
  'elastic',
  'postman'
];

const boards = parseList(argValue('boards') || process.env.GREENHOUSE_QA_BOARDS || defaultBoards.join(','));
const includeTitleKeywords = parseList(argValue('include-title-keywords') || process.env.GREENHOUSE_QA_INCLUDE_TITLE_KEYWORDS || [
  'customer',
  'client',
  'support',
  'service',
  'success',
  'experience',
  'assistant',
  'admin',
  'administrator',
  'administrative',
  'operations',
  'coordinator',
  'specialist',
  'representative',
  'associate',
  'onboarding',
  'implementation',
  'community',
  'data entry',
  'scheduling',
  'virtual assistant',
  'office'
].join(','));
const excludeKeywords = parseList(argValue('exclude-keywords') || process.env.GREENHOUSE_QA_EXCLUDE_KEYWORDS || [
  'senior',
  'manager',
  'director',
  'developer',
  'engineer',
  'architect',
  'staff',
  'principal',
  'bilingual',
  'spanish',
  'german',
  'french',
  'legal counsel',
  'security clearance',
  'registered nurse',
  'physician',
  'accountant',
  'controller'
].join(','));

const config = buildConfig(['node', 'qa-greenhouse-sister', '--profile=sister']);
config.noRealSubmission = true;
config.testMode = true;
config.sites.greenhouse = {
  ...(config.sites.greenhouse || {}),
  enabled: true,
  autoApplyEnabled: false,
  remoteOnly: false,
  maxJobsPerRun: Number.parseInt(argValue('max') || process.env.GREENHOUSE_QA_MAX_JOBS_PER_RUN || process.env.SISTER_GREENHOUSE_MAX_JOBS_PER_RUN || '120', 10),
  boards,
  includeTitleKeywords,
  excludeKeywords
};

if (!config.deepseekApiKey) {
  throw new Error('DeepSeek key missing. Use railway run or set DEEPSEEK_API_KEY.');
}

const profile = await loadOrBuildCandidateProfile(config);
config.candidateProfile = profile;
config.cvData = await loadCvData(config);
const resumeText = await readResumeText(config.resumePath);
const jobs = await scrapeGreenhouseJobs(config, config.sites.greenhouse);

console.log(`[greenhouse-qa:sister] Boards: ${boards.join(', ')}`);
console.log(`[greenhouse-qa:sister] Include title keywords: ${includeTitleKeywords.join(', ') || '(none)'}`);
console.log(`[greenhouse-qa:sister] Exclude keywords: ${excludeKeywords.join(', ') || '(none)'}`);
console.log(`[greenhouse-qa:sister] Scraped after source filters: ${jobs.length}`);

const rows = [];
for (const job of jobs) {
  const local = await localMatchJob(job, profile, config);
  if (local.score < 40) {
    rows.push({ job, local, status: 'ignore' });
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
  rows.push({ job, local, verification, optimizer, status: approved ? 'approved' : 'review' });
}

const ranked = rows
  .filter((row) => row.status !== 'ignore')
  .sort((a, b) => (b.optimizer?.application_score || b.local.score) - (a.optimizer?.application_score || a.local.score));

console.log(`[greenhouse-qa:sister] Advanced to DeepSeek/review: ${ranked.length}`);
console.log(`[greenhouse-qa:sister] Approved to apply: ${ranked.filter((row) => row.status === 'approved').length}`);

for (const row of ranked.slice(0, 25)) {
  const aiScore = row.verification?.adjusted_score ?? '-';
  const appScore = row.optimizer?.application_score ?? '-';
  const reason = String(row.verification?.reasoning || row.local.reasons?.join('; ') || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  console.log(
    `[${row.status.toUpperCase()}] local=${row.local.score} ai=${aiScore} app=${appScore} | ${row.job.title} - ${row.job.company} | ${row.job.location || ''}`
  );
  console.log(`  ${row.job.applicationUrl}`);
  console.log(`  ${reason}`);
}
