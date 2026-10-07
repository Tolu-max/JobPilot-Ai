import { buildConfig } from '../src/config.js';
import { loadJobStore } from '../src/jobStore.js';

const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
const store = await loadJobStore(config);

const targetJob = (store.jobs || []).find(j => 
  (j.url && j.url.includes('wrk87j')) || 
  (j.job_url && j.job_url.includes('wrk87j')) ||
  (j.applicationUrl && j.applicationUrl.includes('wrk87j')) ||
  (j.title && j.title.toLowerCase().includes('web and graphics'))
);

console.log('Target Jobberman Job:', JSON.stringify(targetJob, null, 2));
