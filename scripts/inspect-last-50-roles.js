import fs from 'node:fs';

for (const profile of ['tolu', 'sister']) {
  const filePath = `profiles/${profile}/processedJobs.json`;
  if (!fs.existsSync(filePath)) {
    console.log(`No store found for ${profile}`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const jobs = Array.isArray(data) ? data : (data.jobs || []);
  const bruntJobs = jobs.filter(j => (j.source || j.site || j.source_site || '').includes('bruntwork'));

  console.log(`\n================================================================`);
  console.log(`  PROFILE: ${profile.toUpperCase()} | Total Bruntwork Processed: ${bruntJobs.length}`);
  console.log(`================================================================`);

  const last50 = bruntJobs.slice(-50);
  console.log(`Showing last ${last50.length} roles (oldest to newest in this slice):\n`);

  for (let i = 0; i < last50.length; i++) {
    const job = last50[i];
    const statusIcon = job.status === 'applied' ? '🟢 [APPLIED]' :
                       job.status === 'reviewed' ? '🟡 [REVIEW]' :
                       job.status === 'pending_apply' ? '⏳ [PENDING]' :
                       job.status === 'failed' ? '🔴 [FAILED]' :
                       '⚪ [IGNORED]';

    const title = (job.title || 'Untitled').padEnd(45).slice(0, 45);
    const score = String(job.score ?? 0).padStart(3);
    const id = String(job.sourceJobId || job.applicationUrl || '').match(/\/jobs\/(\d+)/)?.[1] || '------';
    const reason = job.reason || job.decision || (job.status === 'ignored' ? 'Low match / filtered' : '');

    console.log(`${String(i + 1).padStart(2)}. ${statusIcon} (Score: ${score}) ID:${id} | ${title} | ${reason.slice(0, 60)}`);
  }
}
