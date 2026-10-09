import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

console.log('[clean-stuck-pending] Scanning for stuck pending_apply jobs...');

const rootDirs = ['/app/data', './data', '.'];
const dbPaths = [];
for (const dir of rootDirs) {
  const p = path.join(dir, 'job-applications.db');
  if (fs.existsSync(p) && !dbPaths.includes(p)) {
    dbPaths.push(p);
  }
}

const profilesDirs = ['/app/data/profiles', './profiles'];
let cleanedJsonCount = 0;

for (const pDir of profilesDirs) {
  if (!fs.existsSync(pDir)) continue;
  let profiles = [];
  try {
    profiles = fs.readdirSync(pDir).filter(p => !p.startsWith('.') && p !== 'example');
  } catch {
    continue;
  }

  for (const prof of profiles) {
    const storePath = path.join(pDir, prof, 'processedJobs.json');
    if (!fs.existsSync(storePath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const rawJobs = data.jobs || [];
      const jobsList = Array.isArray(rawJobs) ? rawJobs : Object.values(rawJobs);
      let changed = false;

      for (const j of jobsList) {
        if (j.status === 'pending_apply') {
          const isIndeed = String(j.source_site || j.source || '').toLowerCase() === 'indeed' ||
            /(?:[a-z]{2}\.)?indeed\.com/i.test(j.applicationUrl || j.job_url || '');
          const isDeterministic = /same-indeed-page|no external ATS|closed|unavailable/i.test(j.reason || '');
          const hasExceededRetries = (j.retryCount || 0) >= 3 || j.terminal === true;

          if (isIndeed || isDeterministic || hasExceededRetries) {
            console.log(`[clean-stuck-pending] Transitioning stuck job to manual_review for ${prof}: "${j.title}"`);
            j.status = 'manual_review';
            j.terminal = true;
            j.retryCount = Math.max(j.retryCount || 0, 3);
            j.reason = j.reason || 'same-indeed-page: no external ATS redirect found (requires manual apply on Indeed)';
            changed = true;
            cleanedJsonCount++;
          }
        }
      }

      if (changed || jobsList.length > 0) {
        const seen = new Map();
        const deduped = [];
        for (const j of jobsList) {
          const key = j.job_hash || `${j.source_site || ''}:${(j.title || '').toLowerCase()}:${(j.company || '').toLowerCase()}`;
          if (seen.has(key)) {
            const existing = seen.get(key);
            if (j.status === 'applied' || (j.status === 'manual_review' && existing.status === 'pending_apply')) {
              Object.assign(existing, j);
            }
            changed = true;
          } else {
            seen.set(key, j);
            deduped.push(j);
          }
        }
        if (changed) {
          data.jobs = deduped;
          fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
          console.log(`[clean-stuck-pending] Updated ${storePath} (cleaned/deduped)`);
        }
      }
    } catch (err) {
      console.warn(`[clean-stuck-pending] Error processing ${storePath}: ${err.message}`);
    }
  }
}

for (const dbPath of dbPaths) {
  try {
    const db = new Database(dbPath);
    const info = db.prepare(`
      UPDATE job_applications
      SET status = 'manual_review'
      WHERE status = 'pending_apply'
        AND (source_site = 'indeed' OR job_url LIKE '%indeed%')
    `).run();
    console.log(`[clean-stuck-pending] Updated ${info.changes} stuck Indeed row(s) to manual_review in ${dbPath}`);
  } catch (err) {
    console.warn(`[clean-stuck-pending] SQLite update failed for ${dbPath}: ${err.message}`);
  }
}

console.log(`[clean-stuck-pending] Cleanup complete. Cleaned ${cleanedJsonCount} stuck JSON job(s).`);
