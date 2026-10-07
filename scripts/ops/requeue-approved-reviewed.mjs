import 'dotenv/config';
import { buildConfig } from '../../src/config.js';
import { loadOrBuildCandidateProfile } from '../../src/profileParser.js';
import { getJobRecord, upsertJobRecord } from '../../src/jobStore.js';
import { validateLiveSubmitReadiness } from '../../src/pipeline.js';

const args = parseArgs(process.argv.slice(2));
const profileName = String(args.profile || '').trim();
const applicationUrl = normalizeUrl(args.url);
const shouldApply = args.apply === true || String(args.apply || '').toLowerCase() === 'true';

if (!profileName || !applicationUrl) {
  console.error('Usage: node scripts/ops/requeue-approved-reviewed.mjs --profile=<name> --url=<job-url> [--apply]');
  process.exit(1);
}

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
const profile = await loadOrBuildCandidateProfile(config);
const record = await getJobRecord(config, { applicationUrl });

if (!record) {
  console.error(`No stored job found for ${applicationUrl}`);
  process.exit(2);
}

if (record.status !== 'reviewed' || record.acceptedViaTelegram !== true) {
  console.error(`Refusing to requeue: status=${record.status}, acceptedViaTelegram=${record.acceptedViaTelegram === true}`);
  process.exit(3);
}

const job = {
  ...record,
  source: record.source_site,
  applicationUrl: record.job_url || applicationUrl
};
const gate = await validateLiveSubmitReadiness({ job, profile, existing: record, config });

console.log(JSON.stringify({
  profile: profileName,
  title: record.title,
  status: record.status,
  acceptedViaTelegram: record.acceptedViaTelegram === true,
  score: record.optimizer?.application_score ?? record.score,
  ready: gate.ready,
  reason: gate.reason,
  mode: shouldApply ? 'apply' : 'dry-run'
}, null, 2));

if (!gate.ready) process.exit(4);
if (!shouldApply) process.exit(0);

const {
  job_hash: _jobHash,
  job_url: _jobUrl,
  title: _title,
  company: _company,
  status: _status,
  updatedAt: _updatedAt,
  createdAt: _createdAt,
  ...details
} = record;

await upsertJobRecord(config, job, 'pending_apply', {
  ...details,
  decision: 'apply',
  reason: '',
  skippedBecause: '',
  retryCount: 0,
  terminal: false,
  requeuedAt: new Date().toISOString()
});

console.log(`Requeued approved job for the next scheduler cycle: ${record.title}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=');
    if (inlineValue !== undefined) parsed[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = true;
  }
  return parsed;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/apply\/?$/i, '').replace(/\/$/, '');
}
