import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('/home/ubuntu/jobpilot/profiles/sister/processedJobs.json', 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.jobs || Object.values(raw));

const hash = '320343d0';
const matched = list.filter(j => (j.job_hash || '').includes(hash) || (j.id || '').includes(hash));
console.log('Matched for ' + hash + ':', JSON.stringify(matched, null, 2));

const pending = list.filter(j => j.status === 'pending_apply');
console.log('\nAll pending_apply (' + pending.length + '):');
for (const j of pending) {
  console.log(`- [${j.score || j.application_score}] ${j.title} (acceptedAt: ${j.acceptedAt || ''})`);
}
