import 'dotenv/config';
import { buildConfig } from '../src/config.js';
import { scrapeJobbermanJobs } from '../src/scrapers/jobberman.js';
import { attemptApplication } from '../src/automation.js';

const args = parseArgs(process.argv.slice(2));
const profile = String(args.profile || 'sister');
const mode = String(args.mode || 'apply-probe');
const categories = parseList(args.categories);
const skipUrls = new Set(parseList(args.skipUrl).map(normalizeUrl));
const realSubmit = parseBoolean(args.realSubmit, false);

process.env.NO_REAL_SUBMISSION = realSubmit ? 'false' : 'true';
process.env.TEST_MODE = 'false';
process.env.HEADLESS = String(args.headless || 'true');

const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
config.noRealSubmission = !realSubmit;
config.testMode = false;
config.autoApply = false;
config.headless = parseBoolean(args.headless, true);
config.captchaWaitMs = parseIntSafe(args.captchaWaitMs, 90000);
config.captchaSolverTimeoutMs = parseIntSafe(args.captchaSolverTimeoutMs, 45000);
config.captchaSolverMaxAttempts = parseIntSafe(args.captchaSolverMaxAttempts, 1);
config.sites = {
  ...config.sites,
  jobberman: {
    ...(config.sites?.jobberman || {}),
    enabled: true,
    cooldownMinutes: 0,
    maxJobsPerRun: parseIntSafe(args.maxJobs, 3),
    detailScanLimit: parseIntSafe(args.detailScanLimit, parseIntSafe(args.maxJobs, 3)),
    ...(categories.length ? { categories } : {})
  }
};
config.enabledSites = ['jobberman'];

console.log(`[jobberman-qa] profile=${profile}`);
console.log(`[jobberman-qa] mode=${mode}`);
console.log(`[jobberman-qa] realSubmit=${realSubmit}`);
console.log(`[jobberman-qa] solverConfigured=${Boolean(config.capsolverApiKey || config.captchaSolvApiKey)}`);
console.log(`[jobberman-qa] captchaWaitMs=${config.captchaWaitMs}`);
console.log(`[jobberman-qa] captchaSolverTimeoutMs=${config.captchaSolverTimeoutMs}`);
console.log(`[jobberman-qa] categories=${JSON.stringify(config.sites.jobberman.categories || [])}`);
console.log(`[jobberman-qa] detailScanLimit=${config.sites.jobberman.detailScanLimit}`);

const jobs = await scrapeJobbermanJobs(config, config.sites.jobberman);
console.log(`[jobberman-qa] scraped=${jobs.length}`);

if (!jobs.length) {
  console.log('[jobberman-qa] no jobs returned');
  process.exit(1);
}

for (const job of jobs) {
  console.log(`- ${job.title} | ${job.company || 'Unknown'} | ${job.postedAt || 'date unknown'} | ${job.applicationUrl}`);
}

if (mode !== 'apply-probe') {
  process.exit(0);
}

const candidates = jobs.filter((job) => !skipUrls.has(normalizeUrl(job.applicationUrl || job.jobUrl)));
const jobIndex = parseIntSafe(args.jobIndex, 0);
const job = candidates[jobIndex];
if (!job) {
  console.log(`[jobberman-qa] no target at jobIndex=${jobIndex} after skipUrl filtering`);
  process.exit(1);
}
console.log(`[jobberman-qa] target=${job.title} | ${job.applicationUrl}`);
const result = await attemptApplication(
  job,
  'I am interested in this role because it matches my background and I can contribute with strong communication, organization, and relevant experience.',
  config
);

console.log(JSON.stringify({
  outcome: result.outcome,
  finalState: result.finalState,
  reason: result.reason,
  debugDir: result.debugDir
}, null, 2));

if (String(result.reason || '').includes('NO_REAL_SUBMISSION')) {
  process.exit(0);
}

if (result.outcome === 'applied_successfully' && result.finalState === 'CONFIRMED_SUCCESS') {
  process.exit(0);
}

process.exit(2);

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

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
