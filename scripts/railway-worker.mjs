import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { startTelegramPolling } from '../src/telegramBot.js';
import { registerRunner } from '../src/botControl.js';
import { syncGmailForProfile, isGmailSyncDue } from '../src/gmail/gmailSync.js';

let activeRunPromise = null;
const activeGmailSyncProfiles = new Set();

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

await bootstrapVolumeDirs();

// Sanitize profiles on volume to ensure strictly bruntwork only and no cooldown lockouts
for (const prof of ['tolu', 'sister']) {
  const pDir = path.join(process.cwd(), 'profiles', prof);
  const pPrefs = path.join(pDir, 'preferences.json');
  try {
    const raw = await fs.readFile(pPrefs, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.enabledSites = ['bruntwork'];
    parsed.sitePriority = ['bruntwork'];
    parsed.siteLimits = { bruntwork: 200 };
    parsed.sites = {
      bruntwork: {
        enabled: true,
        maxJobsPerRun: 200,
        maxAgeDays: 7,
        cooldownMinutes: 1,
        autoApplyEnabled: true
      }
    };
    await fs.writeFile(pPrefs, JSON.stringify(parsed, null, 2), 'utf8');
    console.log(`[worker] Sanitized ${prof} preferences to bruntwork only.`);
  } catch (err) {
    console.error(`[worker] Failed to sanitize ${prof} preferences:`, err.message);
  }

  const pState = path.join(pDir, 'siteRunState.json');
  try {
    await fs.writeFile(pState, JSON.stringify({ sites: {} }, null, 2), 'utf8');
    console.log(`[worker] Reset ${prof} siteRunState cooldowns.`);
  } catch (err) {}
}

const workerConfigs = workerProfiles.map((profile) =>
  buildConfig([process.execPath, 'jobpilot', `--profile=${profile}`])
);

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

    // Automated non-overlapping incremental Gmail sync for profile
    await runAutomatedGmailSync(profile);
  }

  return { ...lastResult, reprocessedProfile };
}

export async function runAutomatedGmailSync(profileName = '') {
  const profile = String(profileName).trim().toLowerCase();
  if (!profile) return { ok: false, skipped: true };

  if (activeGmailSyncProfiles.has(profile)) {
    console.log(`[worker] [gmailSync] Sync already in progress for ${profile}; skipping overlapping run.`);
    return { ok: true, skipped: true, reason: 'concurrency_lock' };
  }

  activeGmailSyncProfiles.add(profile);
  try {
    const profileConfig = buildConfig([process.execPath, 'jobpilot', `--profile=${profile}`]);
    const due = await isGmailSyncDue(profileConfig);
    if (!due) {
      return { ok: true, skipped: true, reason: 'not_due' };
    }

    console.log(`[worker] [gmailSync] Starting automated Gmail sync for profile: ${profile}...`);
    const result = await syncGmailForProfile(profileConfig);
    if (result?.skipped) {
      console.log(`[worker] [gmailSync] Profile ${profile}: ${result.reason || 'skipped'}`);
    } else if (result?.ok) {
      console.log(`[worker] [gmailSync] Profile ${profile} completed: ${result.eventsProcessed ?? 0} event(s) processed.`);
    } else if (result?.error) {
      console.warn(`[worker] [gmailSync] Profile ${profile} error: ${result.error}`);
    }
    return result;
  } catch (err) {
    console.warn(`[worker] [gmailSync] Unexpected failure for ${profile}: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    activeGmailSyncProfiles.delete(profile);
  }
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

  // Clean transient and bulky debug/test/browser-profile dirs on volume to prevent ENOSPC
  await cleanVolumeStorage(dataDir);

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

async function cleanVolumeStorage(dataDir) {
  try {
    const transientDirs = ['debug', 'test-results', 'browser-profiles', '.railway-inspect', 'tmp'];
    for (const t of transientDirs) {
      const target = path.join(dataDir, t);
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    }

    // Prune oversized log files in logs directory
    const logsDir = path.join(dataDir, 'logs');
    const logFiles = await fs.readdir(logsDir).catch(() => []);
    for (const f of logFiles) {
      const p = path.join(logsDir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.size > 2 * 1024 * 1024) {
        await fs.writeFile(p, '', 'utf8').catch(() => {});
      }
    }
    console.log('[worker] Volume transient storage cleaned.');
  } catch (err) {
    console.warn('[worker] Volume cleaning non-fatal error:', err.message);
  }
}
