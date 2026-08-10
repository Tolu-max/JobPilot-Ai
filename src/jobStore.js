import fs from 'node:fs/promises';
import path from 'node:path';
import { createJobHash } from './jobHash.js';
import lockfile from 'proper-lockfile';
import { emitEvent, EventTypes } from './eventBus.js';

async function ensureFileExists(filepath, initialContent = '{"jobs":[]}') {
  try {
    await fs.access(filepath);
  } catch {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, initialContent, 'utf8');
  }
}

export function hashJob(job) {
  return createJobHash(job);
}

export async function loadJobStore(config) {
  await fs.mkdir(path.dirname(config.jobStorePath), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(config.jobStorePath, 'utf8'));
  } catch {
    return { jobs: [] };
  }
}

export async function loadGlobalJobStore(config) {
  if (!config.globalJobStorePath) return { jobs: [] };
  await fs.mkdir(path.dirname(config.globalJobStorePath), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(config.globalJobStorePath, 'utf8'));
  } catch {
    return { jobs: [] };
  }
}

export async function saveJobStore(config, store) {
  await fs.mkdir(path.dirname(config.jobStorePath), { recursive: true });
  await fs.writeFile(config.jobStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export async function saveGlobalJobStore(config, store) {
  if (!config.globalJobStorePath) return;
  await fs.mkdir(path.dirname(config.globalJobStorePath), { recursive: true });
  await fs.writeFile(config.globalJobStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export async function resetProcessedJobs(config, options = {}) {
  await ensureFileExists(config.jobStorePath);
  let release = () => {};
  try {
    release = await lockfile.lock(config.jobStorePath, { retries: 5, stale: 10000 });
    const store = await loadJobStore(config);
    const before = Array.isArray(store.jobs) ? store.jobs.length : 0;
    const removed = [];
    const kept = [];

    for (const record of store.jobs || []) {
      if (shouldResetRecord(record, options)) removed.push(record);
      else kept.push(record);
    }

    await saveJobStore(config, {
      ...store,
      jobs: kept,
      resetHistory: [
        ...(Array.isArray(store.resetHistory) ? store.resetHistory.slice(-9) : []),
        {
          resetAt: new Date().toISOString(),
          profile: config.profileName || 'default',
          mode: options.allNonApplied ? 'all-non-applied' : 'retryable',
          removed: removed.length,
          kept: kept.length
        }
      ]
    });

    return { before, after: kept.length, removed: removed.length, kept: kept.length };
  } catch (error) {
    console.error(`[jobStore] Lock error on ${config.jobStorePath}:`, error.message);
    throw error;
  } finally {
    await release();
  }
}

export async function getJobRecord(config, job) {
  const store = await loadJobStore(config);
  const jobHash = hashJob(job);
  return store.jobs.find((record) => record.job_hash === jobHash || record.job_url === job.applicationUrl) || null;
}

export async function getGlobalJobRecord(config, job) {
  const store = await loadGlobalJobStore(config);
  const jobHash = hashJob(job);
  return store.jobs.find((record) => record.job_hash === jobHash || record.job_url === job.applicationUrl) || null;
}

export async function upsertJobRecord(config, job, status, details = {}) {
  await ensureFileExists(config.jobStorePath);
  let release = () => {};
  try {
    release = await lockfile.lock(config.jobStorePath, { retries: 5, stale: 10000 });
    const store = await loadJobStore(config);
    const jobHash = hashJob(job);
    const existingIndex = store.jobs.findIndex(
      (record) => record.job_hash === jobHash || record.job_url === job.applicationUrl
    );
    const record = {
      job_hash: jobHash,
      source_site: job.source_site || job.source || 'unknown',
      job_url: job.applicationUrl,
      title: job.title,
      company: job.company || '',
      status,
      updatedAt: new Date().toISOString(),
      reason: details.reason || '',
      ...details
    };

    if (existingIndex >= 0) {
      const prev = store.jobs[existingIndex];
      const retryStates = ['failed', 'manual_review'];
      const requestedRetryCount = Number.parseInt(details.retryCount, 10);
      const retryCount = Number.isFinite(requestedRetryCount) && requestedRetryCount >= 0
        ? requestedRetryCount
        : retryStates.includes(prev.status) && retryStates.includes(status)
          ? (prev.retryCount || 0) + 1
          : (prev.retryCount || 0);
      store.jobs[existingIndex] = { ...prev, ...record, retryCount };
    } else {
      const requestedRetryCount = Number.parseInt(details.retryCount, 10);
      const retryCount = Number.isFinite(requestedRetryCount) && requestedRetryCount >= 0
        ? requestedRetryCount
        : 0;
      store.jobs.push({ ...record, retryCount, createdAt: new Date().toISOString() });
    }

    await saveJobStore(config, store);
    await emitJobStatusChanged(config, record, existingIndex >= 0 ? 'updated' : 'created');
    return record;
  } catch (error) {
    console.error(`[jobStore] Lock error on ${config.jobStorePath}:`, error.message);
    throw error;
  } finally {
    await release();
  }
}

export async function upsertGlobalJobRecord(config, job, status, details = {}) {
  if (!config.globalJobStorePath) return null;

  await ensureFileExists(config.globalJobStorePath);
  let release = () => {};
  try {
    release = await lockfile.lock(config.globalJobStorePath, { retries: 5, stale: 10000 });
    const store = await loadGlobalJobStore(config);
    const jobHash = hashJob(job);
    const existingIndex = store.jobs.findIndex(
      (record) => record.job_hash === jobHash || record.job_url === job.applicationUrl
    );
    const record = {
      job_hash: jobHash,
      source_site: job.source_site || job.source || 'unknown',
      job_url: job.applicationUrl,
      title: job.title,
      company: job.company || '',
      applied_by_profile: config.profileName || 'default',
      status,
      updatedAt: new Date().toISOString(),
      reason: details.reason || '',
      ...details
    };

    if (existingIndex >= 0) {
      store.jobs[existingIndex] = { ...store.jobs[existingIndex], ...record };
    } else {
      store.jobs.push({ ...record, createdAt: new Date().toISOString() });
    }

    await saveGlobalJobStore(config, store);
    await emitJobStatusChanged(config, record, existingIndex >= 0 ? 'global_updated' : 'global_created');
    return record;
  } catch (error) {
    console.error(`[jobStore] Lock error on ${config.globalJobStorePath}:`, error.message);
    throw error;
  } finally {
    await release();
  }
}

async function emitJobStatusChanged(config, record, action) {
  await emitEvent(EventTypes.JOB_STATUS_CHANGED, {
    action,
    job_hash: record.job_hash,
    title: record.title,
    company: record.company,
    status: record.status,
    source_site: record.source_site,
    score: record.score ?? null,
    decision: record.decision ?? null,
    job_url: record.job_url
  }, config).catch(() => {});
}

export function shouldSkipProcessed(record) {
  if (!record) return false;
  if (record.terminal === true) return true;
  // Permanently skip jobs that reached a definitive terminal state.
  // 'reviewed' is included: once queued for Telegram action it must not be re-notified
  // until the user explicitly acts (Accept / Skip) or the record is reset.
  const permanentStates = ['applied', 'duplicate', 'skipped', 'reviewed'];
  if (permanentStates.includes(record.status)) return true;
  // Ignored jobs are terminal for a profile unless a run explicitly passes --reprocess.
  if (record.status === 'ignored') return true;
  // Allow retrying failed/manual_review jobs up to 3 times total, then permanently skip
  if (record.status === 'failed' || record.status === 'manual_review') {
    const retries = record.retryCount || 0;
    return retries >= 3;
  }
  return false;
}

function shouldResetRecord(record, options = {}) {
  if (!record) return false;
  if (record.status === 'applied') return false;
  if (options.allNonApplied) return true;

  const retryableStatuses = new Set(['ignored', 'reviewed', 'failed', 'manual_review']);
  if (retryableStatuses.has(record.status)) return true;

  const reason = [
    record.reason,
    record.local?.reasons,
    record.gemini?.reasoning,
    record.aiAnalysis?.reasoning,
    record.analysis?.reasoning
  ].flat().filter(Boolean).join(' ');
  return /ai.*fail|provider.*fail|fallback|quota|resource_exhausted|no skill grounding/i.test(reason);
}

export function shouldSkipGlobalProcessed(record, config) {
  if (!record || config.allowDuplicateJobs) return false;
  const owner = record.applied_by_profile || record.profileName;
  if (!owner || owner === config.profileName) return false;
  // Only block cross-profile when the other profile actually applied — not merely ignored/reviewed
  return record.status === 'applied';
}
