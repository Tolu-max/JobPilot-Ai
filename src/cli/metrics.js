import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const STATUS_REVIEWING = new Set(['reviewed', 'pending_apply', 'manual_review']);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read the full state of the system in one pass.
 * Used by snapshot (one-shot) and dashboard (refreshed on a timer).
 */
export async function readMetrics({ rootDir = ROOT } = {}) {
  const profilesDir = path.join(rootDir, 'profiles');
  const profiles = await listProfiles(profilesDir);

  const perProfile = [];
  const activity = [];
  let totals = {
    profiles: profiles.length,
    applied24h: 0,
    appliedAllTime: 0,
    reviewQueue: 0,
    failed24h: 0,
    scrapedAllTime: 0
  };

  const cutoff = Date.now() - DAY_MS;

  for (const name of profiles) {
    const profile = await readProfileMetrics(profilesDir, name, cutoff);
    perProfile.push(profile);
    totals.applied24h     += profile.applied24h;
    totals.appliedAllTime += profile.appliedAllTime;
    totals.reviewQueue    += profile.reviewQueue;
    totals.failed24h      += profile.failed24h;
    totals.scrapedAllTime += profile.total;
    for (const a of profile.recent) activity.push({ ...a, profile: name });
  }

  activity.sort((a, b) => b.ts - a.ts);

  return {
    generatedAt: new Date().toISOString(),
    totals,
    perProfile,
    recentActivity: activity.slice(0, 12),
    lastRunAt: activity[0]?.ts ?? null,
    nextRunAt: estimateNextRun(activity[0]?.ts)
  };
}

async function listProfiles(profilesDir) {
  try {
    const entries = await fs.readdir(profilesDir);
    return entries.filter((name) => !name.startsWith('.') && name !== 'example');
  } catch {
    return [];
  }
}

async function readProfileMetrics(profilesDir, name, cutoff) {
  const profileDir = path.join(profilesDir, name);
  const storePath  = path.join(profileDir, 'processedJobs.json');
  const prefsPath  = path.join(profileDir, 'preferences.json');

  let displayName = name;
  let autoApply = false;
  try {
    const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf-8'));
    displayName = prefs.displayName || name;
    autoApply = prefs.autoApply === true;
  } catch { /* prefs missing */ }

  let jobs = [];
  try {
    const store = JSON.parse(await fs.readFile(storePath, 'utf-8'));
    jobs = store.jobs || [];
  } catch { /* no run yet */ }

  let applied24h = 0;
  let appliedAllTime = 0;
  let reviewQueue = 0;
  let failed24h = 0;
  const recent = [];

  for (const job of jobs) {
    const ts = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
    if (job.status === 'applied') {
      appliedAllTime += 1;
      if (ts >= cutoff) applied24h += 1;
    }
    if (STATUS_REVIEWING.has(job.status)) reviewQueue += 1;
    if (job.status === 'failed' && ts >= cutoff) failed24h += 1;
    if (ts > 0) {
      recent.push({
        ts,
        time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        site: job.source || job.site || '—',
        title: job.title || '(untitled)',
        company: job.company || '',
        status: job.status,
        url: job.url || ''
      });
    }
  }

  recent.sort((a, b) => b.ts - a.ts);

  return {
    name,
    displayName,
    autoApply,
    total: jobs.length,
    applied24h,
    appliedAllTime,
    reviewQueue,
    failed24h,
    recent: recent.slice(0, 8)
  };
}

function estimateNextRun(lastRunTs) {
  if (!lastRunTs) return null;
  const interval = parseInt(process.env.SCHEDULER_INTERVAL_MS, 10) || 14400000;
  return lastRunTs + interval;
}

/**
 * AI spend estimate — best-effort, based on the local cache file.
 * Returns { calls, estimatedUsd } or null if the cache isn't present.
 */
export async function readAiSpend(rootDir = ROOT) {
  try {
    const cachePath = path.join(rootDir, 'data', 'aiCache.json');
    const raw = await fs.readFile(cachePath, 'utf-8');
    const cache = JSON.parse(raw);
    const calls = Object.keys(cache).length;
    const estimatedUsd = (calls * 0.0005).toFixed(2);
    return { calls, estimatedUsd: Number(estimatedUsd) };
  } catch {
    return null;
  }
}

/**
 * Last N lines of the app log, parsed.
 */
export async function readRecentLog(rootDir = ROOT, lines = 200) {
  try {
    const logPath = path.join(rootDir, 'logs', 'app.log');
    const raw = await fs.readFile(logPath, 'utf-8');
    return raw.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

export function formatRelative(ts, now = Date.now()) {
  if (!ts) return '—';
  const ms = now - ts;
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function formatRelativeFuture(ts, now = Date.now()) {
  if (!ts) return '—';
  const ms = ts - now;
  if (ms <= 0) return 'now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  const mins = min - hr * 60;
  return mins ? `in ${hr}h ${mins}m` : `in ${hr}h`;
}
