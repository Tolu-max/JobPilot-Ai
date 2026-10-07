import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));

export async function runBruntWorkLiveRerunOnce() {
  const requestId = sanitize(process.env.JOBPILOT_BRUNTWORK_LIVE_RERUN_ID || '');
  if (!requestId) return { skipped: true, reason: 'not-requested' };

  const dataDir = process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(rootDir, 'data'));
  const requestedLimit = positiveInt(process.env.JOBPILOT_BRUNTWORK_LIVE_RERUN_LIMIT, 70);
  const applyLimit = positiveInt(process.env.JOBPILOT_BRUNTWORK_LIVE_RERUN_APPLY_LIMIT, 5);
  const profileTimeoutMs = positiveInt(process.env.JOBPILOT_BRUNTWORK_PROFILE_TIMEOUT_MS, 20 * 60 * 1000);
  const clearApplied = readBoolean(process.env.JOBPILOT_BRUNTWORK_LIVE_RERUN_CLEAR_APPLIED, false);
  const profiles = parseProfiles(process.env.JOBPILOT_BRUNTWORK_LIVE_RERUN_PROFILES || 'sister,tolu');
  const statePath = path.join(dataDir, 'maintenance', `bruntwork-live-rerun-${requestId}.json`);
  const state = await readJson(statePath) || {
    requestId,
    status: 'started',
    startedAt: new Date().toISOString(),
    cleanupComplete: false,
    profiles: {}
  };

  if (state.status === 'completed') {
    console.log(`[bruntwork-live-rerun] Request ${requestId} already completed; skipping.`);
    return state;
  }

  console.log(`[bruntwork-live-rerun] Starting ${requestId}. Live submissions and auto-apply are enabled; normal safety gates remain active.`);
  if (!state.cleanupComplete) {
    state.cleanup = await clearBruntWorkProcessed(dataDir, requestId, { clearApplied });
    state.cleanupComplete = true;
    state.cleanupCompletedAt = new Date().toISOString();
    await writeJson(statePath, state);
  }

  for (const profile of profiles) {
    if (state.profiles?.[profile]?.status === 'completed') continue;
    state.profiles[profile] = { status: 'running', startedAt: new Date().toISOString() };
    await writeJson(statePath, state);

    const resultPath = path.join(dataDir, 'maintenance', `bruntwork-live-rerun-${requestId}-${profile}.log`);
    try {
      await runNode([
        path.join(rootDir, 'cli.js'),
        'run',
        `--profile=${profile}`,
        '--sites=bruntwork',
        `--max-jobs=${requestedLimit}`,
        `--max-applies=${applyLimit}`
      ], liveEnv(profile, requestedLimit, applyLimit), resultPath, profileTimeoutMs, profile);
    } catch (error) {
      console.error(`[bruntwork-live-rerun] ${profile} failed: ${error.message}`);
      state.profiles[profile] = {
        status: 'failed',
        failedAt: new Date().toISOString(),
        resultPath,
        error: error.message
      };
      await writeJson(statePath, state);
      continue;
    }

    const resultText = await fs.readFile(resultPath, 'utf8').catch(() => '');
    console.log(`[bruntwork-live-rerun] ${profile} result:\n${resultText.slice(-12000)}`);
    const ignoreAudit = await summarizeIgnored(dataDir, profile);
    console.log(`[bruntwork-live-rerun] ${profile} ignore audit: ${JSON.stringify(ignoreAudit)}`);

    state.profiles[profile] = {
      status: 'completed',
      completedAt: new Date().toISOString(),
      resultPath,
      ignoreAudit
    };
    await writeJson(statePath, state);
  }

  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  await writeJson(statePath, state);
  console.log(`[bruntwork-live-rerun] Completed ${requestId}: ${JSON.stringify(state)}`);
  return state;
}

async function summarizeIgnored(dataDir, profile) {
  const file = path.join(dataDir, 'profiles', profile, 'processedJobs.json');
  const store = await readJson(file) || { jobs: [] };
  const ignored = (store.jobs || []).filter((job) => isBruntWork(job) && job.status === 'ignored');
  const buckets = new Map();

  for (const job of ignored) {
    const reasons = [
      job.reason,
      job.local?.reasons,
      job.gemini?.reasoning,
      job.gemini?.reasons,
      job.optimizer?.risk_flags?.map((flag) => flag.message),
      job.optimizer?.reasoning
    ].flat().filter(Boolean).map(compactReason);
    const key = classifyIgnoreReason(reasons.join(' | '), job);
    const bucket = buckets.get(key) || { reason: key, count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 5) bucket.examples.push({ title: job.title, score: job.score, detail: reasons.slice(0, 2) });
    buckets.set(key, bucket);
  }

  return {
    total: ignored.length,
    buckets: Array.from(buckets.values()).sort((a, b) => b.count - a.count)
  };
}

function classifyIgnoreReason(text, job) {
  if (/Profile role QA/i.test(text)) return 'profile role-family gate';
  if (/non-English|foreign language|bilingual/i.test(text)) return 'language requirement';
  if (/work authorization|country|location|not remote|onsite/i.test(text)) return 'location/work-authorization gate';
  if (/senior|experience|required years|qualification/i.test(text)) return 'experience/qualification mismatch';
  if (/skill|missing|match|fit|relevance/i.test(text)) return 'low skill/profile fit';
  if (/risk|quality|ground|unsupported|claim/i.test(text)) return 'application quality/risk gate';
  if (Number(job?.score) < 40) return 'low score below AI consideration floor';
  return 'optimizer recommendation: ignore';
}

function compactReason(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

async function clearBruntWorkProcessed(dataDir, requestId, { clearApplied = false } = {}) {
  const targets = [
    path.join(dataDir, 'profiles', 'tolu', 'processedJobs.json'),
    path.join(dataDir, 'profiles', 'sister', 'processedJobs.json'),
    path.join(dataDir, 'globalProcessedJobs.json')
  ];
  const results = [];

  for (const file of targets) {
    const raw = await fs.readFile(file, 'utf8');
    const store = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const jobs = Array.isArray(store.jobs) ? store.jobs : [];
    // Normally preserve confirmed applications. An explicit maintenance flag
    // may clear them too, but the backup makes the destructive run recoverable.
    const removed = jobs.filter((job) => isBruntWork(job) && (clearApplied || job.status !== 'applied'));
    const kept = jobs.filter((job) => !isBruntWork(job) || (!clearApplied && job.status === 'applied'));
    const backup = `${file}.backup-${requestId}`;
    await fs.copyFile(file, backup);
    await fs.writeFile(file, `${JSON.stringify({ ...store, jobs: kept }, null, 2)}\n`, 'utf8');
    const result = { file, backup, before: jobs.length, removed: removed.length, appliedCleared: clearApplied, after: kept.length };
    results.push(result);
    console.log(`[bruntwork-live-rerun] cleanup ${JSON.stringify(result)}`);
  }
  return results;
}

function liveEnv(profile, requestedLimit, applyLimit) {
  const prefix = profile.toUpperCase();
  return {
    ...process.env,
    NO_REAL_SUBMISSION: 'false',
    TEST_MODE: 'false',
    AUTO_APPLY: 'true',
    MAX_AUTO_APPLY_PER_RUN: String(applyLimit),
    ENABLED_SITES: 'bruntwork',
    MAX_JOBS_PER_RUN: String(requestedLimit),
    [`${prefix}_AUTO_APPLY`]: 'true',
    [`${prefix}_MAX_AUTO_APPLY_PER_RUN`]: String(applyLimit),
    [`${prefix}_ENABLED_SITES`]: 'bruntwork',
    [`${prefix}_MAX_JOBS_PER_RUN`]: String(requestedLimit),
    [`${prefix}_BRUNTWORK_MAX_JOBS_PER_RUN`]: String(requestedLimit),
    [`${prefix}_BRUNTWORK_AUTO_APPLY_ENABLED`]: 'true',
    [`${prefix}_BRUNTWORK_COOLDOWN_MINUTES`]: '0',
    BRUNTWORK_COOLDOWN_MINUTES: '0'
  };
}

function runNode(args, env, resultPath, timeoutMs, profile) {
  return new Promise(async (resolve, reject) => {
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    const handle = await fs.open(resultPath, 'a');
    const child = spawn(process.execPath, args, { cwd: rootDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const forward = (chunk) => {
      handle.write(chunk).catch(() => {});
      process.stdout.write(`[bruntwork-live-rerun:${profile}] ${chunk}`);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', async (error) => { clearTimeout(timer); await handle.close(); reject(error); });
    child.once('exit', async (code, signal) => {
      clearTimeout(timer);
      await handle.close();
      if (code === 0) resolve();
      else reject(new Error(`Live run exited with code=${code} signal=${signal || 'none'}; log=${resultPath}`));
    });
  });
}

function parseProfiles(value) {
  const allowed = new Set(['tolu', 'sister']);
  const profiles = String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter((item) => allowed.has(item));
  return profiles.length ? [...new Set(profiles)] : ['sister', 'tolu'];
}

function isBruntWork(job = {}) {
  return String(job.source_site || job.source || '').toLowerCase() === 'bruntwork';
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sanitize(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runBruntWorkLiveRerunOnce();
}
