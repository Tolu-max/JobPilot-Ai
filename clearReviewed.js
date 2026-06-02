import { readFileSync, writeFileSync } from 'fs';
['tolu', 'sister'].forEach((profile) => {
  const path = `profiles/${profile}/processedJobs.json`;
  const d = JSON.parse(readFileSync(path));
  const before = d.jobs.length;
  // Remove 'reviewed' and 'ignored' — keep only 'applied', 'failed', 'duplicate'
  d.jobs = d.jobs.filter((j) => j.status === 'applied' || j.status === 'failed' || j.status === 'duplicate');
  writeFileSync(path, JSON.stringify(d, null, 2));
  console.log(`${profile}: kept ${d.jobs.length} of ${before} (applied/failed/duplicate only)`);
});
