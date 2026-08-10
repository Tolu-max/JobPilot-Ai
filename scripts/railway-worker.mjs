import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { startTelegramPolling } from '../src/telegramBot.js';
import { registerRunner } from '../src/botControl.js';

let activeRunPromise = null;

const delayMs = Number.parseInt(process.env.WORKER_RESTART_DELAY_MS || '900000', 10);
const reprocessProfiles = new Set(
  String(process.env.REPROCESS_NON_APPLIED_PROFILES || '')
    .split(/[,\s;|]+/)
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const reprocessRequestId = String(process.env.REPROCESS_NON_APPLIED_REQUEST_ID || 'default')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .slice(0, 80);
const reprocessMarker = path.join(
  process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(process.cwd(), 'data')),
  'maintenance',
  `reprocess-non-applied-${reprocessRequestId}.json`
);
const rankProfiles = new Set(
  String(process.env.RANK_IGNORED_PROFILES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const resendProfiles = new Set(
  String(process.env.RESEND_REVIEW_PROFILES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const resetProfiles = new Set(
  String(process.env.RESET_NON_APPLIED_PROFILES || '')
    .split(/[,\s;|]+/)
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const inspectReviewProfiles = new Set(
  String(process.env.INSPECT_REVIEW_PROFILES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const sendReviewSummaryProfiles = new Set(
  String(process.env.SEND_PENDING_REVIEW_SUMMARY || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const inspectLogProfiles = new Set(
  String(process.env.INSPECT_PROFILE_LOGS || '')
    .split(/[,:\s;|]+/)
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean)
);
const resetRequestId = String(process.env.RESET_NON_APPLIED_REQUEST_ID || 'default')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .slice(0, 80);
const resetMarker = path.join(
  process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(process.cwd(), 'data')),
  'maintenance',
  `reset-non-applied-${resetRequestId}.json`
);

const workerProfiles = String(process.env.PROFILES || 'tolu,sister')
  .split(',')
  .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
  .filter(Boolean);
const workerConfigs = workerProfiles.map((profile) =>
  buildConfig([process.execPath, 'jobpilot', `--profile=${profile}`])
);

await bootstrapVolumeDirs();
registerRunner(() => runPass());
if (resetProfiles.size > 0 && !(await fileExists(resetMarker))) {
  for (const profile of resetProfiles) {
    await runDiagnostic(profile, 'cli.js', true, ['reset-jobs', '--all-non-applied']);
  }
  await fs.mkdir(path.dirname(resetMarker), { recursive: true });
  await fs.writeFile(resetMarker, `${JSON.stringify({ completedAt: new Date().toISOString(), profiles: [...resetProfiles] }, null, 2)}\n`);
  console.log(`[worker] marked one-time non-applied reset complete: ${[...resetProfiles].join(',')}`);
}
if (process.env.JOBPILOT_BRUNTWORK_RECHECK_ID) {
  await runDiagnostic('bruntwork-recheck', 'ops/run-bruntwork-recheck-once.mjs', false);
}
await startTelegramPolling(workerConfigs);
console.log(`[worker] Telegram polling enabled for ${workerProfiles.join(',')}`);

for (const profile of rankProfiles) {
  await runDiagnostic(profile);
}
for (const profile of resendProfiles) {
  await runDiagnostic(profile, 'resend-profile-reviews.mjs');
}
for (const profile of inspectReviewProfiles) {
  await runDiagnostic(profile, 'inspect-review-state.mjs');
}
for (const profile of sendReviewSummaryProfiles) {
  await runDiagnostic(profile, 'send-pending-review-summary.mjs');
}
for (const profile of inspectLogProfiles) {
  await runDiagnostic(profile, 'inspect-profile-log.mjs');
}

while (true) {
  const result = await runPass();
  if (result.reprocessedProfile) {
    await fs.mkdir(path.dirname(reprocessMarker), { recursive: true });
    await fs.writeFile(reprocessMarker, `${JSON.stringify({ completedAt: new Date().toISOString(), profiles: [...reprocessProfiles] }, null, 2)}\n`);
    console.log(`[worker] marked one-time non-applied reprocess complete: ${[...reprocessProfiles].join(',')}`);
  }
  console.log(`[worker] profile pass exited code=${result.code ?? 'null'} signal=${result.signal || 'none'}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function runPass() {
  if (activeRunPromise) return activeRunPromise;
  activeRunPromise = runProfilesIndividually().finally(() => {
    activeRunPromise = null;
  });
  return activeRunPromise;
}

async function runProfilesIndividually() {
  const profiles = String(process.env.PROFILES || 'tolu,sister')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  let lastResult = { code: 0, signal: null };
  let reprocessedProfile = false;
  const markerExists = await fileExists(reprocessMarker);

  for (const profile of profiles) {
    const reprocess = !markerExists && reprocessProfiles.has(profile.toLowerCase());
    const args = ['cli.js', 'run', `--profile=${profile}`];
    if (reprocess) args.push('--reprocess-non-applied');
    lastResult = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit'
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal, profile }));
    });
    console.log(`[worker] ${profile} run exited code=${lastResult.code ?? 'null'} signal=${lastResult.signal || 'none'}`);
    reprocessedProfile ||= reprocess;
  }

  return { ...lastResult, reprocessedProfile };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runDiagnostic(profile, script = 'rank-ignored-profile.mjs', includeProfile = true, extraArgs = []) {
  await new Promise((resolve, reject) => {
    const args = [script === 'cli.js' ? script : `scripts/${script}`];
    if (script === 'cli.js') args.push(...extraArgs);
    if (includeProfile) args.push(`--profile=${profile}`);
    if (script !== 'cli.js') args.push(...extraArgs);
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      console.log(`[worker] ${script} ${profile} exited code=${code ?? 'null'} signal=${signal || 'none'}`);
      resolve();
    });
  });
}

async function bootstrapVolumeDirs() {
  if (!process.env.RAILWAY_ENVIRONMENT && process.env.JOBPILOT_DATA_DIR === undefined) return;

  const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
  const names = ['profiles', 'logs', 'events', 'review', 'debug', 'browser-profiles', 'test-results'];

  for (const name of names) {
    const source = path.resolve(process.cwd(), name);
    const target = path.join(dataDir, name);
    await fs.mkdir(target, { recursive: true });

    let sourceStat = null;
    try {
      sourceStat = await fs.lstat(source);
    } catch {
      // The image does not contain a source directory yet.
    }

    if (sourceStat?.isSymbolicLink()) continue;
    if (sourceStat) await fs.rm(source, { recursive: true, force: true });
    await fs.symlink(target, source, 'dir');
  }

  process.env.JOBPILOT_PROFILE_BOOTSTRAPPED = '1';
  console.log(`[worker] linked persistent data directories from ${dataDir}`);
}
