const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const raw = fs.readFileSync('/app/data/profiles/tolu/processedJobs.json', 'utf8');
const parsed = JSON.parse(raw);
const isArr = Array.isArray(parsed);
const jobs = isArr ? parsed : (parsed.jobs || Object.values(parsed));

// Find jobs with score >= 50 that are currently ignored and not hard-excluded
const toReview = jobs.filter(j => j.score >= 50 && j.status === 'ignored' && (!j.decision || j.decision === 'ignore'));

console.log('Found ' + toReview.length + ' jobs with score >= 50 that can be moved to reviewed.');
toReview.forEach(j => {
  console.log(\`SCORE: \${j.score} | TITLE: \${j.title} | CO: \${j.company} | SRC: \${j.source_site || j.source} | URL: \${j.job_url || j.url}\`);
});
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
