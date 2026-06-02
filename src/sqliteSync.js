/**
 * SQLite sync for job applications - simple local database tracking
 */
import Database from 'better-sqlite3';
import { appendLog } from './logger.js';
import path from 'path';
import fs from 'fs';

const DB_DIR = './data';
const DB_PATH = path.join(DB_DIR, 'job-applications.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS job_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_name TEXT NOT NULL,
    job_hash TEXT NOT NULL,
    title TEXT,
    company TEXT,
    source_site TEXT,
    job_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    score INTEGER,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_name, job_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_profile_status ON job_applications(profile_name, status);
  CREATE INDEX IF NOT EXISTS idx_source_site ON job_applications(source_site);
  CREATE INDEX IF NOT EXISTS idx_job_hash ON job_applications(job_hash);
`);

/**
 * Sync job applications to SQLite
 */
export async function syncJobApplicationsToSQLite(jobs, config) {
  if (!jobs || jobs.length === 0) {
    return { synced: 0, failed: 0 };
  }

  const profileName = config.profileName || 'default';
  let synced = 0;
  let failed = 0;

  const insert = db.prepare(`
    INSERT INTO job_applications (
      profile_name, job_hash, title, company, source_site,
      job_url, status, score, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_name, job_hash) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      status = excluded.status,
      score = excluded.score,
      applied_at = excluded.applied_at,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((jobs) => {
    for (const job of jobs) {
      try {
        insert.run(
          profileName,
          job.job_hash,
          job.title || null,
          job.company || null,
          job.source_site || null,
          job.job_url || job.applicationUrl || null,
          job.status || 'pending',
          job.score ?? job.local?.score ?? null,
          job.status === 'applied' ? (job.updatedAt || new Date().toISOString()) : null
        );
        synced++;
      } catch (err) {
        console.error(`[SQLite] Failed to sync job ${job.job_hash}:`, err.message);
        failed++;
      }
    }
  });

  try {
    transaction(jobs);
    await appendLog(`[SQLite] Synced ${synced} job applications to ${DB_PATH}`, config);
    return { synced, failed };
  } catch (err) {
    await appendLog(`[SQLite] Sync error: ${err.message}`, config);
    return { synced: 0, failed: jobs.length };
  }
}

/**
 * Get job application stats
 */
export function getJobStats(profileName = null) {
  const query = profileName
    ? db.prepare('SELECT status, COUNT(*) as count FROM job_applications WHERE profile_name = ? GROUP BY status')
    : db.prepare('SELECT status, COUNT(*) as count FROM job_applications GROUP BY STATUS');

  const rows = profileName ? query.all(profileName) : query.all();

  const stats = {
    total: 0,
    by_status: {}
  };

  for (const row of rows) {
    stats.by_status[row.status] = row.count;
    stats.total += row.count;
  }

  return stats;
}

/**
 * Get recent applications
 */
export function getRecentApplications(profileName = null, limit = 10) {
  const query = profileName
    ? db.prepare('SELECT * FROM job_applications WHERE profile_name = ? ORDER BY created_at DESC LIMIT ?')
    : db.prepare('SELECT * FROM job_applications ORDER BY created_at DESC LIMIT ?');

  return profileName ? query.all(profileName, limit) : query.all(limit);
}

export { db };
