const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const raw = fs.readFileSync('/app/data/profiles/tolu/processedJobs.json', 'utf8');
const parsed = JSON.parse(raw);
const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || Object.values(parsed));

const ngJobs = jobs.filter(j => (j.source_site === 'jobberman' || j.source_site === 'myjobmag' || j.source === 'jobberman' || j.source === 'myjobmag'));
console.log('Total Jobberman + MyJobMag jobs in Tolu DB:', ngJobs.length);
const techOrScored = ngJobs.filter(j => j.score > 0 || /developer|engineer|software|web|graphic|frontend|backend|fullstack|data|seo/i.test(j.title));
console.log('Tech or scored > 0 (' + techOrScored.length + '):');
techOrScored.forEach(j => {
  console.log(\`SCORE: \${j.score} | STATUS: \${j.status} | TITLE: \${j.title} | CO: \${j.company} | SRC: \${j.source_site || j.source} | URL: \${j.job_url || j.url}\`);
});
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
