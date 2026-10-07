import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clearBruntWorkApplied } from './clear-bruntwork-applied.mjs';

const rootDir = path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));

export async function runBruntWorkRecheckOnce() {
  const requestId = sanitize(process.env.JOBPILOT_BRUNTWORK_RECHECK_ID || '');
  if (!requestId) return { skipped: true, reason: 'not-requested' };

  const dataDir = process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(rootDir, 'data'));
  const stateDir = path.join(dataDir, 'maintenance');
  const reportDir = path.join(dataDir, 'audit', 'bruntwork-recheck', requestId);
  const statePath = path.join(stateDir, `bruntwork-recheck-${requestId}.json`);
  await fs.mkdir(stateDir, { recursive: true });

  const state = await readJson(statePath) || {
    requestId,
    status: 'started',
    startedAt: new Date().toISOString(),
    cleanupComplete: false,
    profiles: {}
  };
  if (state.status === 'completed') {
    console.log(`[bruntwork-recheck] Request ${requestId} already completed; skipping.`);
    return state;
  }

  console.log(`[bruntwork-recheck] Starting request ${requestId}. Submissions are disabled.`);
  if (!state.cleanupComplete) {
    state.cleanup = await clearBruntWorkApplied({ dataDir, stamp: requestId });
    state.cleanupComplete = true;
    state.cleanupCompletedAt = new Date().toISOString();
    await writeJson(statePath, state);
  }

  for (const profile of ['tolu', 'sister']) {
    if (state.profiles?.[profile]?.status === 'completed') continue;
    const reportPath = path.join(reportDir, `${profile}.json`);
    state.profiles[profile] = { status: 'running', reportPath, startedAt: new Date().toISOString() };
    await writeJson(statePath, state);

    await runNode([
      path.join(rootDir, 'scripts', 'qa-bruntwork-profile.mjs'),
      `--profile=${profile}`,
      '--limit=60',
      `--report=${reportPath}`
    ], {
      ...process.env,
      NO_REAL_SUBMISSION: 'true',
      AUTO_APPLY: 'false',
      MAX_AUTO_APPLY_PER_RUN: '0',
      [`${profile.toUpperCase()}_AUTO_APPLY`]: 'false'
    });

    const report = await readJson(reportPath);
    state.profiles[profile] = {
      status: 'completed',
      reportPath,
      completedAt: new Date().toISOString(),
      scraped: report?.scraped ?? 0,
      counts: report?.counts || {},
      ignoredByProfileQa: report?.ignoredByProfileQa ?? 0,
      wouldAdvance: Array.isArray(report?.wouldAdvance) ? report.wouldAdvance.length : 0
    };
    await writeJson(statePath, state);
  }

  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  await writeJson(statePath, state);
  console.log(`[bruntwork-recheck] Completed request ${requestId}: ${JSON.stringify(state)}`);
  return state;
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: rootDir, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`QA process exited with code=${code} signal=${signal || 'none'}`));
    });
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sanitize(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runBruntWorkRecheckOnce();
}
