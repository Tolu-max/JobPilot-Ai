import fs from 'node:fs/promises';
import path from 'node:path';
import { createJobHash, normalizeUrl } from './jobHash.js';
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

function findMatchingRecordIndex(jobs = [], job, jobHash) {
  const targetHash = job?.job_hash || jobHash;
  const targetUrl = normalizeUrl(job?.applicationUrl || job?.job_url || job?.url || '');
  const targetTitle = String(job?.title || '').trim().toLowerCase();
  const targetCompany = String(job?.company || '').trim().toLowerCase();
  const targetJobId = String(job?.sourceJobId || '').trim();

  return jobs.findIndex((record) => {
    if (record.job_hash && (record.job_hash === targetHash || record.job_hash === jobHash)) return true;
    if (targetJobId && record.sourceJobId && record.sourceJobId === targetJobId) return true;
    if (record.job_url && (record.job_url === job?.applicationUrl || record.job_url === job?.job_url)) return true;
    if (record.applicationUrl && (record.applicationUrl === job?.applicationUrl || record.applicationUrl === job?.job_url)) return true;
    if (targetUrl) {
      const recUrl = normalizeUrl(record.job_url || record.applicationUrl || record.url || '');
      if (recUrl && recUrl === targetUrl) return true;
    }
    if (targetTitle && record.title && record.title.trim().toLowerCase() === targetTitle) {
      if (!targetCompany || !record.company || targetCompany === 'not listed' || record.company.toLowerCase() === 'not listed') {
        return true;
      }
      if (record.company.trim().toLowerCase() === targetCompany) {
        return true;
      }
    }
    return false;
  });
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
  if (!config?.jobStorePath) return;
  await fs.mkdir(path.dirname(config.jobStorePath), { recursive: true });
  const tmpPath = `${config.jobStorePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, config.jobStorePath);
}

export async function saveGlobalJobStore(config, store) {
  if (!config.globalJobStorePath) return;
  await fs.mkdir(path.dirname(config.globalJobStorePath), { recursive: true });
  const tmpPath = `${config.globalJobStorePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, config.globalJobStorePath);
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
  const idx = findMatchingRecordIndex(store.jobs, job, jobHash);
  return idx >= 0 ? store.jobs[idx] : null;
}

export async function getGlobalJobRecord(config, job) {
  const store = await loadGlobalJobStore(config);
  const jobHash = hashJob(job);
  const idx = findMatchingRecordIndex(store.jobs, job, jobHash);
  return idx >= 0 ? store.jobs[idx] : null;
}

export async function upsertJobRecord(config, job, status, details = {}) {
  await ensureFileExists(config.jobStorePath);
  let release = () => {};
  try {
    release = await lockfile.lock(config.jobStorePath, { retries: 5, stale: 10000 });
    const store = await loadJobStore(config);
    const jobHash = job.job_hash || details.job_hash || hashJob(job);
    const existingIndex = findMatchingRecordIndex(store.jobs, job, jobHash);
    const resolvedUrl = job.applicationUrl || job.job_url || details.applicationUrl || details.job_url || '';
    const record = {
      job_hash: jobHash,
      source_site: job.source_site || job.source || details.source_site || details.source || 'unknown',
      sourceJobId: job.sourceJobId || details.sourceJobId || '',
      job_url: resolvedUrl,
      applicationUrl: resolvedUrl,
      title: job.title || details.title || '',
      company: job.company || details.company || '',
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
      store.jobs[existingIndex] = {
        ...prev,
        ...record,
        job_hash: prev.job_hash || record.job_hash || jobHash,
        retryCount
      };
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
    const jobHash = job.job_hash || details.job_hash || hashJob(job);
    const existingIndex = findMatchingRecordIndex(store.jobs, job, jobHash);
    const resolvedUrl = job.applicationUrl || job.job_url || details.applicationUrl || details.job_url || '';
    const record = {
      job_hash: jobHash,
      source_site: job.source_site || job.source || 'unknown',
      job_url: resolvedUrl,
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
  // Permanently skip jobs that have already been processed in any known state.
  // 'reviewed' and 'pending_apply' must not be re-notified as new review jobs.
  // 'manual_review', 'failed', 'ignored', 'duplicate', 'skipped', and 'applied'
  // must all be skipped during routine scraper passes so the bot does not resurface old jobs.
  const processedStates = [
    'applied',
    'pending_apply',
    'reviewed',
    'manual_review',
    'ignored',
    'duplicate',
    'skipped',
    'failed'
  ];
  return processedStates.includes(record.status);
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
