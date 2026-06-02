import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

if (process.platform === 'win32') {
  const _req = createRequire(import.meta.url);
  const cp = _req('child_process');
  const _origSpawn = cp.spawn;
  cp.spawn = function (cmd, args, opts) {
    return _origSpawn.call(this, cmd, Array.isArray(args) ? args : [], { windowsHide: true, ...(opts || {}) });
  };
  const _origExec = cp.exec;
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return _origExec.call(this, cmd, { windowsHide: true, ...(opts || {}) }, cb);
  };
  const _origExecFile = cp.execFile;
  cp.execFile = function (file, args, opts, cb) {
    if (typeof args === 'function') { cb = args; args = []; opts = {}; }
    else if (typeof opts === 'function') { cb = opts; opts = {}; }
    return _origExecFile.call(this, file, args, { windowsHide: true, ...(opts || {}) }, cb);
  };
}

import { buildConfig } from './config.js';
import { appendLog } from './logger.js';
import { runJobHunt } from './pipeline.js';
import { sendNotification } from './notifications.js';
import { startTelegramPolling, sendDailySummary } from './telegramBot.js';
import { startDashboardServer } from './dashboardServer.js';
import { pruneAiCache } from './aiRouter.js';
import { checkEmailResponses } from './responseTracker.js';

import fs from 'node:fs';
import path from 'node:path';

let running = false;
let activeConfigs = [];

export async function startScheduler(argv = process.argv) {
  const baseConfig = buildConfig(argv);
  const profilesDir = path.join(baseConfig.rootDir, 'profiles');

  const requestedProfile = resolveProfileNameArg(argv);
  let profileNames = requestedProfile ? [requestedProfile] : ['tolu'];
  if (!requestedProfile) {
    try {
      profileNames = fs.readdirSync(profilesDir).filter(p => !p.startsWith('.') && p !== 'example');
    } catch (err) {
      console.warn('Could not read profiles dir, falling back to default.');
    }
  }

  activeConfigs = profileNames.map(name => buildConfig([...argv, `--profile=${name}`]));
  const primaryConfig = activeConfigs[0];

  await appendLog(`Scheduler started. Interval: ${primaryConfig.schedulerIntervalMs}ms`, primaryConfig);
  await sendNotification(`Job hunter scheduler started for ${profileNames.length} profile(s).`, primaryConfig);

  // Prune stale AI cache entries at startup
  await pruneAiCache(primaryConfig.aiCachePath, primaryConfig.aiCacheMaxAgeHours || 24);

  // Start listening for Telegram button callbacks
  startTelegramPolling(activeConfigs);

  // The HTTP dashboard is a local/dev tool. The normal product path is the CLI
  // scheduler plus optional hosted dashboard sync.
  if (isLocalDashboardEnabled()) {
    const dashPort = parseInt(process.env.DASHBOARD_PORT || '3000', 10);
    startDashboardServer(activeConfigs, dashPort);
  }

  scheduleDailySummary(primaryConfig);

  const runOnce = createSchedulerRunner(activeConfigs);

  await runOnce();
  setInterval(runOnce, primaryConfig.schedulerIntervalMs);
}

function resolveProfileNameArg(argv) {
  const inline = argv.find((arg) => arg.startsWith('--profile='));
  if (inline) return inline.split('=').slice(1).join('=').trim();

  const index = argv.findIndex((arg) => arg === '--profile');
  if (index >= 0 && argv[index + 1]) return String(argv[index + 1]).trim();

  return '';
}

export function createSchedulerRunner(configs, runFn = runJobHunt) {
  return async function runOnce() {
    if (running) {
      await appendLog('Scheduler skipped tick because previous run is still active.', configs[0]);
      return { skipped: true };
    }

    running = true;
    try {
      for (const config of configs) {
        await appendLog(`--- Processing profile: ${config.profileName} ---`, config);
        await runFn(config);
        
        // Also check emails after pipeline finishes
        await checkEmailResponses(config).catch(err => {
          appendLog(`ResponseTracker error in scheduler: ${err.message}`, config);
        });
      }

      return { skipped: false };
    } catch (error) {
      await appendLog(`Scheduler run failed: ${error.stack || error.message}`, configs[0]);
      await sendNotification(`Job hunter run failed: ${error.message}`, configs[0]);
      throw error;
    } finally {
      running = false;
    }
  };
}

/**
 * Schedule a daily Telegram summary at 8 AM local time.
 * Fires once per day — uses a simple interval check every minute.
 */
function scheduleDailySummary(config) {
  let lastSummaryDate = null;

  setInterval(async () => {
    const now = new Date();
    const dateKey = now.toDateString();
    if (now.getHours() === 8 && lastSummaryDate !== dateKey) {
      lastSummaryDate = dateKey;
      await sendDailySummary(config).catch((err) => {
        console.error('[Scheduler] Daily summary failed:', err.message);
      });
    }
  }, 60 * 1000); // check every minute
}

function isLocalDashboardEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.JOBPILOT_LOCAL_DASHBOARD || '').toLowerCase());
}

process.on('uncaughtException', async (error) => {
  await appendLog(`Uncaught exception: ${error.stack || error.message}`, activeConfigs[0]);
  await sendNotification(`Scheduler crashed: ${error.message}`, activeConfigs[0]).catch(() => {});
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', async (reason) => {
  const message = reason?.stack || reason;
  await appendLog(`Unhandled rejection: ${message}`, activeConfigs[0]);
  await sendNotification(`Scheduler rejected: ${reason?.message || reason}`, activeConfigs[0]).catch(() => {});
});

if (process.argv[1] && (
  process.argv[1].endsWith('scheduler.js') || 
  process.argv[1].endsWith('scheduler') ||
  process.env.PM2_HOME
)) {
  startScheduler();
}
