import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { scrapeBruntWorkJobs } from '../src/scrapers/bruntwork.js';
import { localMatchJob } from '../src/localMatcher.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { loadCvData } from '../src/cvParser.js';
import { hasAvailableAiProvider } from '../src/aiRouter.js';

const args = parseArgs(process.argv.slice(2));
const profileName = String(args.profile || 'tolu');
const limit = positiveInt(args.limit, 100);
const outDir = args.out || path.join('audit', 'profile-role-qa');
const reportPath = args.report ? path.resolve(args.report) : '';

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
config.noRealSubmission = true;
config.autoApply = false;
config.maxAutoApplyPerRun = 0;
config.geminiMinLocalScore = 0;
config.sites = {
  bruntwork: {
    ...(config.sites?.bruntwork || {}),
    enabled: true,
    cooldownMinutes: 0,
    maxJobsPerRun: limit,
    includeKeywords: [],
    includeTitleKeywords: [],
    excludeKeywords: []
  }
};
config.enabledSites = ['bruntwork'];

const profile = await loadOrBuildCandidateProfile(config);
const cvData = await loadCvData(config).catch(() => null);
if (cvData) config.cvData = cvData;

console.log(`[qa] Profile: ${config.profileName}`);
console.log(`[qa] BruntWork limit: ${limit}`);
console.log(`[qa] AI provider available: ${hasAvailableAiProvider(config) ? 'yes' : 'no - using local fallback where needed'}`);
console.log('[qa] Submissions: disabled');

const jobs = await scrapeBruntWorkJobs(config, config.sites.bruntwork);
console.log(`[qa] Scraped ${jobs.length} BruntWork role(s)`);

const rows = [];
for (const job of jobs) {
  const result = await localMatchJob(job, profile, config);
  rows.push({
    title: job.title,
    url: job.applicationUrl,
    score: result.score,
    recommendation: result.recommendation,
    reasons: result.reasons || [],
    matchedSkills: result.matchedSkills || [],
    missingSkills: result.missingSkills || []
  });
}

const risky = rows.filter((row) => ['review', 'auto_apply', 'instant_apply'].includes(row.recommendation));
const ignoredByQa = rows.filter((row) => row.score === 0 && row.reasons.some((reason) => /Profile role QA/i.test(reason)));
const report = {
  generatedAt: new Date().toISOString(),
  profile: config.profileName,
  limit,
  aiProviderAvailable: hasAvailableAiProvider(config),
  scraped: rows.length,
  counts: countBy(rows, (row) => row.recommendation),
  ignoredByProfileQa: ignoredByQa.length,
  wouldAdvance: risky,
  rows
};

const outPath = reportPath || path.join(outDir, `bruntwork-${config.profileName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('');
console.log('[qa] Recommendation counts:', JSON.stringify(report.counts));
console.log(`[qa] Ignored by profile QA: ${ignoredByQa.length}`);
console.log(`[qa] Would advance to review/apply: ${risky.length}`);
if (risky.length) {
  console.log('');
  console.log('[qa] Roles that would advance:');
  for (const row of risky.slice(0, 25)) {
    console.log(`- ${row.score} ${row.recommendation}: ${row.title}`);
    console.log(`  ${row.url}`);
    console.log(`  ${row.reasons.slice(0, 2).join(' | ')}`);
  }
  if (risky.length > 25) console.log(`- ...${risky.length - 25} more in report`);
}
console.log('');
console.log(`[qa] Report written: ${outPath}`);

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

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
