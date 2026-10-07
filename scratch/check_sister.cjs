const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const raw = fs.readFileSync('/app/data/profiles/sister/processedJobs.json', 'utf8');
const parsed = JSON.parse(raw);
const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || Object.values(parsed));

const queued = jobs.filter(j => ['reviewed', 'pending_apply', 'manual_review'].includes(j.status));

console.log('Sister Queued Jobs (' + queued.length + '):');
queued.sort((a,b) => (b.score || 0) - (a.score || 0));

queued.forEach((j, i) => {
  console.log(\`[\${i+1}] \${j.title} | \${j.company || 'Unknown'} | Score: \${j.score} | Status: \${j.status} | Source: \${j.source_site || j.source} | URL: \${j.job_url || j.url}\`);
});
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
