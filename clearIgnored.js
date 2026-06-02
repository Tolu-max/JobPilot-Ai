import { readFileSync, writeFileSync } from 'fs';
const fs = { readFileSync, writeFileSync };
['tolu', 'sister'].forEach((profile) => {
  const path = `profiles/${profile}/processedJobs.json`;
  const d = JSON.parse(fs.readFileSync(path));
  const before = d.jobs.length;
  d.jobs = d.jobs.filter((j) => j.status !== 'ignored');
  fs.writeFileSync(path, JSON.stringify(d, null, 2));
  console.log(`${profile}: removed ${before - d.jobs.length} ignored, kept ${d.jobs.length} (applied/failed/reviewed)`);
});
