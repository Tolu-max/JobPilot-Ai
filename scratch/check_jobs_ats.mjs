import fs from 'node:fs';
import { getAdapter } from '../src/adapters/index.js';

async function checkJobs() {
  for (const profile of ['tolu', 'sister']) {
    console.log(`\n=================== ${profile.toUpperCase()} JOBS ===================`);
    const file = `profiles/${profile}/processedJobs.json`;
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const jobs = data.jobs || [];
    const reviewed = jobs.filter(j => j.status === 'reviewed' || j.status === 'pending_apply');
    
    for (const job of reviewed) {
      const url = job.job_url || job.applicationUrl || job.url;
      let adapterName = 'unknown';
      try {
        const ad = getAdapter(url);
        adapterName = ad ? ad.name : 'none';
      } catch (e) {
        adapterName = 'error: ' + e.message;
      }
      console.log(`[${job.status}] ${job.title} | ${job.company} | ${job.source_site || job.source}`);
      console.log(`  URL: ${url}`);
      console.log(`  Adapter: ${adapterName}`);
    }
  }
}

checkJobs().catch(console.error);
