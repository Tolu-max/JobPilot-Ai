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
const workerProfiles = String(process.env.PROFILES || 'tolu,sister')
  .split(',')
  .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
  .filter(Boolean);

console.log(`[aws-worker] Starting JobPilot AWS Runner for profiles: ${workerProfiles.join(', ')}`);
console.log(`[aws-worker] Loop delay interval: ${delayMs / 1000}s`);

await bootstrapVolumeDirs();

const workerConfigs = workerProfiles.map((profile) =>
  buildConfig([process.execPath, 'jobpilot', `--profile=${profile}`])
);

registerRunner(() => runPass());

try {
  await startTelegramPolling(workerConfigs);
  console.log(`[aws-worker] Telegram polling active for ${workerProfiles.join(',')}`);
} catch (err) {
  console.warn(`[aws-worker] Telegram polling failed to start:`, err.message);
}

// Graceful shutdown handling for AWS ECS / App Runner SIGTERM signals
let isShuttingDown = false;
process.on('SIGTERM', () => {
  console.log('[aws-worker] Received SIGTERM signal. Preparing graceful exit...');
  isShuttingDown = true;
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[aws-worker] Received SIGINT signal. Exiting...');
  isShuttingDown = true;
  process.exit(0);
});

while (!isShuttingDown) {
  try {
    const result = await runPass();
    console.log(`[aws-worker] Profile pass completed with exit code: ${result.code ?? 0}`);
  } catch (err) {
    console.error(`[aws-worker] Error during profile pass:`, err);
  }

  if (isShuttingDown) break;
  console.log(`[aws-worker] Waiting ${(delayMs / 1000).toFixed(0)}s before next job scraping cycle...`);
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

  for (const profile of profiles) {
    if (isShuttingDown) break;
    console.log(`\n========================================`);
    console.log(`[aws-worker] Starting job scraper run for: ${profile}`);
    console.log(`========================================`);

    const args = ['cli.js', 'run', `--profile=${profile}`];
    lastResult = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit'
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal, profile }));
    });
    console.log(`[aws-worker] ${profile} run exited with code: ${lastResult.code ?? 'null'}`);

    // Automated non-overlapping incremental Gmail sync for profile
    try {
      await runAutomatedGmailSync(profile);
    } catch (err) {
      console.warn(`[aws-worker] Gmail sync warning for ${profile}:`, err.message);
    }
  }

  return lastResult;
}

export async function runAutomatedGmailSync(profileName = '') {
  const profile = String(profileName).trim().toLowerCase();
  if (!profile) return { ok: false, skipped: true };

  if (activeGmailSyncProfiles.has(profile)) {
    console.log(`[aws-worker] [gmailSync] Sync already running for ${profile}; skipping.`);
    return { ok: true, skipped: true, reason: 'concurrency_lock' };
  }

  activeGmailSyncProfiles.add(profile);
  try {
    const profileConfig = buildConfig([process.execPath, 'jobpilot', `--profile=${profile}`]);
    const due = await isGmailSyncDue(profileConfig);
    if (!due) {
      return { ok: true, skipped: true, reason: 'not_due' };
    }

    console.log(`[aws-worker] [gmailSync] Starting automated Gmail sync for ${profile}...`);
    const result = await syncGmailForProfile(profileConfig);
    if (result?.skipped) {
      console.log(`[aws-worker] [gmailSync] Profile ${profile}: ${result.reason || 'skipped'}`);
    } else if (result?.ok) {
      console.log(`[aws-worker] [gmailSync] Profile ${profile} completed: ${result.eventsProcessed ?? 0} event(s) processed.`);
    } else if (result?.error) {
      console.warn(`[aws-worker] [gmailSync] Profile ${profile} error: ${result.error}`);
    }
    return result;
  } catch (err) {
    console.warn(`[aws-worker] [gmailSync] Failure for ${profile}: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    activeGmailSyncProfiles.delete(profile);
  }
}

async function bootstrapVolumeDirs() {
  if (!process.env.AWS_EXECUTION_ENV && !process.env.JOBPILOT_DATA_DIR && process.env.JOBPILOT_CLOUD_RUNTIME !== 'aws') return;

  const dataDir = process.env.JOBPILOT_DATA_DIR || '/app/data';
  const names = ['profiles', 'logs', 'events', 'review', 'debug', 'browser-profiles', 'test-results'];

  await cleanVolumeStorage(dataDir);

  for (const name of names) {
    const source = path.resolve(process.cwd(), name);
    const target = path.join(dataDir, name);
    await fs.mkdir(target, { recursive: true });

    let sourceStat = null;
    try {
      sourceStat = await fs.lstat(source);
    } catch {}

    if (sourceStat?.isSymbolicLink()) continue;
    if (sourceStat?.isDirectory()) {
      await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false }).catch(() => {});
      await fs.rm(source, { recursive: true, force: true });
    } else if (sourceStat) {
      await fs.rm(source, { recursive: true, force: true });
    }
    await fs.symlink(target, source, 'dir');
  }

  process.env.JOBPILOT_PROFILE_BOOTSTRAPPED = '1';
  console.log(`[aws-worker] Linked persistent data directories to ${dataDir}`);
}

async function cleanVolumeStorage(dataDir) {
  try {
    const transientDirs = ['debug', 'test-results', 'browser-profiles', 'tmp'];
    for (const t of transientDirs) {
      const target = path.join(dataDir, t);
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    }

    const logsDir = path.join(dataDir, 'logs');
    const logFiles = await fs.readdir(logsDir).catch(() => []);
    for (const f of logFiles) {
      const p = path.join(logsDir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.size > 2 * 1024 * 1024) {
        await fs.writeFile(p, '', 'utf8').catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[aws-worker] Volume cleaning non-fatal warning:', err.message);
  }
}
