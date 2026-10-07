// One-off: reset only status==='failed' records across live stores.
// Hard-preserves 'applied' (aborts if any applied would be lost). Backs up each file.
// Reads APPLY env: '1' = write changes, anything else = dry run.
import fs from 'node:fs';

const APPLY = process.env.APPLY === '1';
const files = [
  '/app/data/globalProcessedJobs.json',
  '/app/data/profiles/tolu/processedJobs.json',
  '/app/data/profiles/sister/processedJobs.json'
];

let grandRemoved = 0;
for (const file of files) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.log(`SKIP ${file}: ${e.message}`); continue; }

  const store = JSON.parse(raw);
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  const byStatus = {};
  for (const j of jobs) byStatus[j.status || '?'] = (byStatus[j.status || '?'] || 0) + 1;

  const appliedBefore = jobs.filter((j) => j.status === 'applied').length;
  const kept = jobs.filter((j) => j.status !== 'failed');
  const removed = jobs.length - kept.length;
  const appliedAfter = kept.filter((j) => j.status === 'applied').length;

  if (appliedAfter !== appliedBefore) {
    console.error(`ABORT ${file}: applied would change ${appliedBefore} -> ${appliedAfter}`);
    process.exit(2);
  }

  console.log(`=== ${file} ===`);
  console.log(`  total=${jobs.length} byStatus=${JSON.stringify(byStatus)}`);
  console.log(`  failed_to_remove=${removed}  applied_preserved=${appliedBefore}  kept=${kept.length}`);

  if (APPLY && removed > 0) {
    fs.writeFileSync(`${file}.bak-failedreset`, raw, 'utf8');
    const next = { ...store, jobs: kept };
    next.resetHistory = [
      ...(Array.isArray(store.resetHistory) ? store.resetHistory.slice(-9) : []),
      { resetAt: new Date().toISOString(), profile: 'maintenance', mode: 'failed-only', removed, kept: kept.length }
    ];
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`  WROTE (backup at ${file}.bak-failedreset)`);
  }
  grandRemoved += removed;
}
console.log(APPLY ? `APPLIED. total failed removed=${grandRemoved}` : `DRY RUN. total failed that would be removed=${grandRemoved}`);
