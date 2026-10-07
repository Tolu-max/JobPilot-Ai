import fs from 'node:fs';

for (const p of ['tolu', 'sister']) {
  const filePath = `profiles/${p}/processedJobs.json`;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const jobs = parsed.jobs || [];
  const brunt = jobs.filter(j => (j.source || j.site || j.source_site || '').includes('bruntwork'));
  console.log(`\n=== Profile: ${p} ===`);
  console.log(`Total jobs: ${jobs.length} | Bruntwork jobs: ${brunt.length}`);
  const st = {};
  for (const j of brunt) {
    st[j.status] = (st[j.status] || 0) + 1;
  }
  console.log('Statuses:', JSON.stringify(st));
  console.log('Latest 5 Bruntwork jobs:');
  for (const j of brunt.slice(-5)) {
    console.log(`  [${j.status}] (score: ${j.score}) "${j.title}" - ${j.url || j.job_url || j.applicationUrl}`);
  }
}
