import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

console.log('[requeue-bruntwork] Promoting eligible BruntWork jobs (score >= 60) to pending_apply...');

const profilesDirs = ['/app/data/profiles', './profiles'];
let profilesDir = null;
for (const dir of profilesDirs) {
  if (fs.existsSync(dir)) {
    profilesDir = dir;
    break;
  }
}

const rootDirs = ['/app/data', './data', '.'];
let dbPath = null;
for (const dir of rootDirs) {
  const p = path.join(dir, 'job-applications.db');
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

let promotedTotal = 0;

if (profilesDir) {
  const profiles = fs.readdirSync(profilesDir).filter(p => !p.startsWith('.') && p !== 'example');
  for (const prof of profiles) {
    const storePath = path.join(profilesDir, prof, 'processedJobs.json');
    const prefPath = path.join(profilesDir, prof, 'preferences.json');
    if (!fs.existsSync(storePath)) continue;

    let exclusions = [];
    if (fs.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
        exclusions = (pref.titleExclusions || []).map(t => String(t).toLowerCase());
      } catch {}
    }

    try {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const rawJobs = data.jobs || [];
      const jobsList = Array.isArray(rawJobs) ? rawJobs : Object.values(rawJobs);
      let changed = false;

      for (const j of jobsList) {
        const source = String(j.source_site || j.source || '').toLowerCase();
        const url = String(j.applicationUrl || j.job_url || '');
        const isBruntwork = source === 'bruntwork' || /bruntwork/i.test(url);
        const score = Number(j.score ?? j.local?.score ?? 0);

        if (isBruntwork && score >= 60 && j.status !== 'applied' && j.status !== 'hired') {
          const title = String(j.title || '').toLowerCase();
          const isExcluded = exclusions.some(ex => title.includes(ex));
          if (isExcluded) continue;

          console.log(`[requeue-bruntwork] Queuing BruntWork role for ${prof}: "${j.title}" (score: ${score}, previous status: ${j.status})`);
          j.status = 'pending_apply';
          j.acceptedViaTelegram = true;
          j.decision = 'apply';
          j.terminal = false;
          j.retryCount = 0;
          delete j.reason;
          changed = true;
          promotedTotal++;

          if (!j.applicationUrl && j.job_url) {
            j.applicationUrl = j.job_url;
          }
        }
      }

      if (changed) {
        fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[requeue-bruntwork] Saved updated jobs to ${storePath}`);
      }
    } catch (err) {
      console.warn(`[requeue-bruntwork] Error processing ${storePath}: ${err.message}`);
    }
  }
}

if (dbPath) {
  try {
    const db = new Database(dbPath);
    const info = db.prepare(`
      UPDATE job_applications
      SET status = 'pending_apply'
      WHERE source_site = 'bruntwork'
        AND score >= 60
        AND status NOT IN ('applied', 'hired')
    `).run();
    console.log(`[requeue-bruntwork] Updated ${info.changes} row(s) in ${dbPath}`);
  } catch (err) {
    console.warn(`[requeue-bruntwork] DB update failed: ${err.message}`);
  }
}

console.log(`[requeue-bruntwork] Complete. Promoted ${promotedTotal} BruntWork job(s) to pending_apply.`);
