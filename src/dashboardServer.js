/**
 * dashboardServer.js
 * Lightweight HTTP dashboard server — no external dependencies.
 * Serves a live stats UI at http://localhost:3000
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLastLogLines } from './logger.js';
import { upsertJobRecord, loadJobStore } from './jobStore.js';
import { loadAuth } from './cli/auth.js';
import { readRecentEvents } from './eventBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = path.join(__dirname, 'dashboard', 'index.html');
const DEFAULT_PORT = 3000;

let _allConfigs = [];

export function startDashboardServer(configs, port = DEFAULT_PORT) {
  _allConfigs = Array.isArray(configs) ? configs : [configs];

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error('[Dashboard] Request error:', err.message);
      sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[Dashboard] Running at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Dashboard] Port ${port} is already in use; using the existing dashboard if it is JobPilot.`);
      return;
    }
    console.error(`[Dashboard] Server error: ${err.message}`);
  });

  return server;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve dashboard HTML
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = await fs.readFile(DASHBOARD_HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Dashboard HTML not found. Please check src/dashboard/index.html</h1>');
    }
    return;
  }

  // API: auth
  if (pathname === '/api/auth' && method === 'GET') {
    const auth = await loadAuth();
    const profiles = _allConfigs.map(c => c.profileName);
    return sendJson(res, 200, { auth, profiles });
  }

  // API: stats
  if (pathname === '/api/stats' && method === 'GET') {
    const stats = await buildStats();
    return sendJson(res, 200, stats);
  }

  // API: job list (paginated, filterable)
  if (pathname === '/api/jobs' && method === 'GET') {
    const profile = url.searchParams.get('profile') || null;
    const status = url.searchParams.get('status') || null;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));
    const jobs = await buildJobList({ profile, status, page, limit });
    return sendJson(res, 200, jobs);
  }

  // API: logs (last N lines)
  if (pathname === '/api/logs' && method === 'GET') {
    const profile = url.searchParams.get('profile') || null;
    const lines = await buildLogs(profile);
    return sendJson(res, 200, { lines });
  }

  // API: recent system events for CLI/web/automation sync
  if (pathname === '/api/events' && method === 'GET') {
    const profile = url.searchParams.get('profile') || null;
    const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
    const config = profile ? findConfig(profile) : {};
    const events = await readRecentEvents(config || {}, limit);
    return sendJson(res, 200, { events });
  }

  // API: approve a job
  if (pathname.startsWith('/api/approve/') && method === 'POST') {
    const jobHash = decodeURIComponent(pathname.split('/api/approve/')[1] || '');
    const profile = url.searchParams.get('profile') || null;
    const result = await approveJob(jobHash, profile);
    return sendJson(res, result.ok ? 200 : 404, result);
  }

  // API: reject a job
  if ((pathname.startsWith('/api/reject/') || pathname.startsWith('/api/cancel/')) && method === 'POST') {
    const prefix = pathname.startsWith('/api/cancel/') ? '/api/cancel/' : '/api/reject/';
    const jobHash = decodeURIComponent(pathname.split(prefix)[1] || '');
    const profile = url.searchParams.get('profile') || null;
    const result = await rejectJob(jobHash, profile);
    return sendJson(res, result.ok ? 200 : 404, result);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

async function buildStats() {
  const profileStats = [];
  const globalTotals = { total: 0, applied: 0, reviewed: 0, pending_apply: 0, ignored: 0, failed: 0, sites: {} };

  for (const config of _allConfigs) {
    let jobs = [];
    try {
      const store = await loadJobStore(config);
      jobs = store.jobs || [];
    } catch { /* skip */ }

    const stats = {
      profile: config.displayName || config.profileName,
      total: jobs.length,
      applied: jobs.filter((j) => j.status === 'applied').length,
      reviewed: jobs.filter((j) => j.status === 'reviewed').length,
      pending_apply: jobs.filter((j) => j.status === 'pending_apply').length,
      ignored: jobs.filter((j) => j.status === 'ignored').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      // Last 24h
      last24h: {
        applied: 0, reviewed: 0, failed: 0, total: 0
      },
      // Per-site breakdown
      sites: {}
    };

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const job of jobs) {
      const site = job.source_site || 'unknown';
      stats.sites[site] = (stats.sites[site] || 0) + 1;
      globalTotals.sites[site] = (globalTotals.sites[site] || 0) + 1;

      if (job.updatedAt && new Date(job.updatedAt).getTime() >= cutoff) {
        stats.last24h.total++;
        if (job.status === 'applied') stats.last24h.applied++;
        if (job.status === 'reviewed') stats.last24h.reviewed++;
        if (job.status === 'failed') stats.last24h.failed++;
      }
    }

    profileStats.push(stats);
    globalTotals.total += stats.total;
    globalTotals.applied += stats.applied;
    globalTotals.reviewed += stats.reviewed;
    globalTotals.pending_apply += stats.pending_apply;
    globalTotals.ignored += stats.ignored;
    globalTotals.failed += stats.failed;
  }

  return {
    profiles: profileStats,
    totals: globalTotals,
    updatedAt: new Date().toISOString()
  };
}

async function buildJobList({ profile, status, page, limit }) {
  let allJobs = [];

  const configs = profile
    ? _allConfigs.filter((c) => (c.displayName || c.profileName) === profile)
    : _allConfigs;

  for (const config of configs) {
    try {
      const store = await loadJobStore(config);
      const profileName = config.displayName || config.profileName;
      const jobs = (store.jobs || []).map((j) => ({ ...j, _profile: profileName }));
      allJobs.push(...jobs);
    } catch { /* skip */ }
  }

  if (status) allJobs = allJobs.filter((j) => j.status === status);

  // Sort: newest first
  allJobs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const total = allJobs.length;
  const offset = (page - 1) * limit;
  const items = allJobs.slice(offset, offset + limit);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

async function buildLogs(profile) {
  const config = profile
    ? _allConfigs.find((c) => (c.displayName || c.profileName) === profile)
    : _allConfigs[0];

  if (!config) return [];

  try {
    return await readLastLogLines(config.logPath, 100);
  } catch {
    return [];
  }
}

async function approveJob(jobHash, profileName) {
  const config = findConfig(profileName);
  if (!config) return { ok: false, error: 'Profile not found' };

  const record = await findByHash(config, jobHash);
  if (!record) return { ok: false, error: 'Job not found' };

  await upsertJobRecord(config, record, 'pending_apply', {
    decision: 'apply',
    acceptedViaDashboard: true,
    acceptedAt: new Date().toISOString(),
    applicationUrl: record.applicationUrl || record.job_url || ''
  });

  return { ok: true, message: `✅ ${record.title} queued for application` };
}

async function rejectJob(jobHash, profileName) {
  const config = findConfig(profileName);
  if (!config) return { ok: false, error: 'Profile not found' };

  const record = await findByHash(config, jobHash);
  if (!record) return { ok: false, error: 'Job not found' };

  await upsertJobRecord(config, record, 'skipped', {
    decision: 'skip',
    rejectedViaDashboard: true,
    rejectedAt: new Date().toISOString()
  });

  return { ok: true, message: `❌ ${record.title} skipped` };
}

function findConfig(profileName) {
  if (!profileName) return _allConfigs[0] || null;
  const normalized = String(profileName).toLowerCase();
  return _allConfigs.find((c) => {
    return [c.displayName, c.profileName].filter(Boolean).some((name) => String(name).toLowerCase() === normalized);
  }) || null;
}

async function findByHash(config, jobHash) {
  try {
    const store = await loadJobStore(config);
    return store.jobs?.find((j) => j.job_hash === jobHash || j.job_hash?.startsWith(jobHash)) || null;
  } catch {
    return null;
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
