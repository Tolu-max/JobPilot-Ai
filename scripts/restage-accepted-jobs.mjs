import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const rootDirs = ['/app/data', './data', '.'];
let dbPath = null;
for (const dir of rootDirs) {
  const p = path.join(dir, 'job-applications.db');
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

const profilesDirs = ['/app/data/profiles', './profiles'];
let profilesDir = null;
for (const dir of profilesDirs) {
  if (fs.existsSync(dir)) {
    profilesDir = dir;
    break;
  }
}

console.log('[restage-accepted-jobs] Running restage for accepted Telegram jobs...');

if (profilesDir) {
  const profiles = fs.readdirSync(profilesDir).filter(p => !p.startsWith('.') && p !== 'example');
  for (const prof of profiles) {
    const storePath = path.join(profilesDir, prof, 'processedJobs.json');
    if (!fs.existsSync(storePath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const rawJobs = data.jobs || [];
      const jobsList = Array.isArray(rawJobs) ? rawJobs : Object.values(rawJobs);
      let restagedCount = 0;

      for (const j of jobsList) {
        if (j.acceptedViaTelegram === true && j.status !== 'applied' && j.status !== 'hired') {
          console.log(`[restage] Restaging accepted job for ${prof}: "${j.title}" (previous status: ${j.status}, reason: ${j.reason || 'none'})`);
          j.status = 'pending_apply';
          j.terminal = false;
          j.retryCount = 0;
          delete j.reason;

          if (/(?:[a-z]{2}\.)?indeed\.com/i.test(j.applicationUrl || '') || String(j.source_site || j.source || '').toLowerCase() === 'indeed') {
            const jkMatch = (j.applicationUrl || '').match(/jk=([a-f0-9]{16})/i) || (j.sourceJobId || '').match(/([a-f0-9]{16})/i);
            const jk = jkMatch ? jkMatch[1] : '';
            if (jk) {
              const slug = String(j.title || '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              j.applicationUrl = slug ? `https://www.indeed.com/job/${slug}-${jk}` : `https://www.indeed.com/viewjob?jk=${jk}`;
            }
          }
          restagedCount++;
        }
      }

      if (restagedCount > 0) {
        fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[restage] Successfully restaged ${restagedCount} accepted job(s) in ${storePath}`);
      }
    } catch (err) {
      console.warn(`[restage] Failed to process ${storePath}: ${err.message}`);
    }
  }
}

if (dbPath) {
  try {
    const db = new Database(dbPath);
    const info = db.prepare(`
      UPDATE job_applications 
      SET status = 'pending_apply' 
      WHERE status IN ('manual_review', 'failed', 'ignored', 'reviewed')
        AND (source_site = 'indeed' OR job_url LIKE '%indeed%')
        AND status NOT IN ('applied', 'hired')
    `).run();
    console.log(`[restage] Updated ${info.changes} Indeed row(s) in SQLite database`);
  } catch (err) {
    console.warn(`[restage] Database update failed: ${err.message}`);
  }
}

console.log('[restage-accepted-jobs] Restage completed.');
