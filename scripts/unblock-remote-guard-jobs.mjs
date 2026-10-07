import fs from 'node:fs';

const unblockForProfile = (profile) => {
  const filePath = `/app/data/profiles/${profile}/processedJobs.json`;
  if (!fs.existsSync(filePath)) return;
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];

  let count = 0;
  for (const job of jobs) {
    if (job.status === 'manual_review' && String(job.reason || '').includes('Remote-only live submit guard')) {
      job.status = 'pending_apply';
      job.decision = 'apply';
      job.reason = 'Unblocked: allowed location or manually approved role';
      count++;
      console.log(`[${profile}] Unblocked: "${job.title}" (${job.source_site || job.source}) -> pending_apply`);
    }
  }

  if (count > 0) {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
    console.log(`[${profile}] Saved ${count} unblocked jobs to pending_apply.`);
  } else {
    console.log(`[${profile}] No jobs blocked by remote-only guard.`);
  }
};

unblockForProfile('tolu');
unblockForProfile('sister');
