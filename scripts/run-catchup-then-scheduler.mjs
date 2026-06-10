import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/config.js';
import { appendLog } from '../src/logger.js';
import { runJobHunt } from '../src/pipeline.js';
import { checkEmailResponses } from '../src/responseTracker.js';
import { bootstrapProfilesFromEnv } from '../src/profileBundleBootstrap.js';
import { startScheduler } from '../src/scheduler.js';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const dataDir = process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(rootDir, 'data'));
const catchupDir = path.join(dataDir, 'catchup');
const catchupFlagPath = path.join(catchupDir, 'bruntwork-50-jobberman-40-2026-06-10-v3.json');

const profileNames = parseProfiles(process.env.PROFILES || process.env.PROFILE || 'tolu,sister');
const changedEnv = new Map();

await bootstrapProfilesFromEnv({ rootDir, logger: console });
process.env.JOBPILOT_PROFILE_BOOTSTRAPPED = '1';
await runCatchupOnce();
restoreEnv();

console.log('[catchup] Starting normal scheduler after catch-up gate.');
await startScheduler(['node', 'jobpilot', 'scheduler']);
await new Promise(() => {});

async function runCatchupOnce() {
  await fs.mkdir(catchupDir, { recursive: true });
  const existing = await readJson(catchupFlagPath);
  if (existing) {
    console.log(`[catchup] BruntWork/Jobberman catch-up already claimed at ${existing.startedAt || existing.completedAt || 'unknown'}; skipping.`);
    return;
  }

  const startedAt = new Date().toISOString();
  await writeJson(catchupFlagPath, {
    status: 'started',
    startedAt,
    profiles: profileNames,
    limits: { bruntwork: 50, jobberman: 40 }
  });

  console.log(`[catchup] Starting one-time BruntWork/Jobberman catch-up for ${profileNames.join(', ')}.`);
  let failures = 0;
  const results = [];

  for (const profileName of profileNames) {
    applyCatchupEnv(profileName);
    const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
    console.log(`[catchup:${profileName}] enabled=${config.enabledSites.join(',')} bruntwork=${config.sites.bruntwork?.maxJobsPerRun} jobberman=${config.sites.jobberman?.maxJobsPerRun}`);

    try {
      await appendLog('One-time catch-up started: bruntwork=50, jobberman=40.', config);
      const rows = await runJobHunt(config);
      await checkEmailResponses(config).catch((err) => appendLog(`ResponseTracker error: ${err.message}`, config));
      const summary = summarizeRows(rows);
      results.push({ profileName, ok: true, ...summary });
      await appendLog(`One-time catch-up finished: ${JSON.stringify(summary)}.`, config);
      console.log(`[catchup:${profileName}] ${JSON.stringify(summary)}`);
    } catch (error) {
      failures += 1;
      results.push({ profileName, ok: false, error: error.message });
      await appendLog(`One-time catch-up failed: ${error.stack || error.message}`, config).catch(() => {});
      console.error(`[catchup:${profileName}] failed: ${error.message}`);
    }
  }

  await writeJson(catchupFlagPath, {
    status: failures > 0 ? 'finished_with_errors' : 'completed',
    startedAt,
    completedAt: new Date().toISOString(),
    profiles: profileNames,
    limits: { bruntwork: 50, jobberman: 40 },
    failures,
    results
  });
}

function applyCatchupEnv(profileName) {
  const prefix = profileName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  setEnv(`${prefix}_ENABLED_SITES`, 'bruntwork,jobberman');
  setEnv(`${prefix}_SITE_PRIORITY`, 'bruntwork,jobberman');
  setEnv(`${prefix}_BRUNTWORK_MAX_JOBS_PER_RUN`, '50');
  setEnv(`${prefix}_JOBBERMAN_MAX_JOBS_PER_RUN`, '40');
  setEnv(`${prefix}_BRUNTWORK_COOLDOWN_MINUTES`, '0');
  setEnv(`${prefix}_JOBBERMAN_COOLDOWN_MINUTES`, '0');
  setEnv(`${prefix}_BRUNTWORK_AUTO_APPLY_ENABLED`, 'true');
  setEnv(`${prefix}_JOBBERMAN_AUTO_APPLY_ENABLED`, 'true');
  setEnv(`${prefix}_AUTO_APPLY`, 'true');
}

function setEnv(key, value) {
  if (!changedEnv.has(key)) changedEnv.set(key, process.env[key]);
  process.env[key] = value;
}

function restoreEnv() {
  for (const [key, value] of changedEnv.entries()) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function parseProfiles(value) {
  const names = String(value || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean);
  return names.length ? [...new Set(names)] : ['tolu', 'sister'];
}

function summarizeRows(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return {
    scraped: items.length,
    applied: items.filter((row) => row.status === 'applied').length,
    review: items.filter((row) => row.status === 'pending' || row.status === 'manual_review').length,
    ignored: items.filter((row) => row.decision === 'ignore' || row.status === 'skipped').length,
    deduped: items.filter((row) => row.deduped || row.status === 'duplicate' || row.decision === 'duplicate').length,
    failed: items.filter((row) => row.status === 'failed').length
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
