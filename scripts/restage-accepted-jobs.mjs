import fs from 'node:fs';
import path from 'node:path';

const profilesDirs = ['/app/data/profiles', './profiles'];
let profilesDir = null;
for (const dir of profilesDirs) {
  if (fs.existsSync(dir)) {
    profilesDir = dir;
    break;
  }
}

console.log('[restage-accepted-jobs] Running safe restage for valid pending Telegram jobs...');

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
          // Never restage jobs that failed deterministically or reached max retries
          const isIndeed = String(j.source_site || j.source || '').toLowerCase() === 'indeed' ||
            /(?:[a-z]{2}\.)?indeed\.com/i.test(j.applicationUrl || j.job_url || '');
          const isDeterministic = /same-indeed-page|no external ATS|closed|unavailable/i.test(j.reason || '');
          const isTerminal = j.terminal === true || (j.retryCount || 0) >= 3;

          if (isIndeed || isDeterministic || isTerminal) {
            continue;
          }

          console.log(`[restage] Restaging accepted job for ${prof}: "${j.title}" (previous status: ${j.status})`);
          j.status = 'pending_apply';
          j.terminal = false;
          j.retryCount = 0;
          delete j.reason;
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

console.log('[restage-accepted-jobs] Safe restage completed.');
