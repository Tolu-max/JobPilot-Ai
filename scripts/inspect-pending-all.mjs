import fs from 'node:fs';

['tolu', 'sister'].forEach(profile => {
  const filePath = `/app/data/profiles/${profile}/processedJobs.json`;
  if (!fs.existsSync(filePath)) return;
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const jobs = store.jobs || [];
  
  const actionable = jobs.filter(j => ['reviewed', 'pending_apply', 'manual_review'].includes(j.status));
  console.log(`\n================== ${profile.toUpperCase()} (${actionable.length} actionable) ==================`);
  for (const job of actionable) {
    console.log(`- [${job.status.toUpperCase()}] "${job.title}" | Site: ${job.source_site || job.source} | Score: ${job.score}`);
    console.log(`  URL: ${job.applicationUrl || job.job_url}`);
    if (job.reason) console.log(`  Reason: ${job.reason}`);
  }
});
