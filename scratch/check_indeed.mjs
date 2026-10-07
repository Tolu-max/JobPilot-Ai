import { buildConfig } from '../src/config.js';
import { loadJobStore } from '../src/jobStore.js';

async function check() {
  for (const profileName of ['tolu', 'sister']) {
    console.log(`\n=== PROFILE: ${profileName} ===`);
    const c = buildConfig(['node', 'check_indeed.mjs', `--profile=${profileName}`]);
    const s = await loadJobStore(c);
    const indeedJobs = (s.jobs || []).filter(j => (j.source_site === 'indeed' || j.source === 'indeed'));
    console.log(`Found ${indeedJobs.length} indeed jobs in store (${c.storePath}).`);
    for (const j of indeedJobs) {
      console.log(`- [${j.status}] "${j.title}" at ${j.company} | score=${j.score} | reason="${j.reason || ''}" | url=${j.applicationUrl}`);
    }
  }
}

check().catch(console.error);
