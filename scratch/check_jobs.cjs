const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const raw = fs.readFileSync('/app/data/profiles/tolu/processedJobs.json', 'utf8');
const parsed = JSON.parse(raw);
const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || Object.values(parsed));

const j = jobs.find(x => x.title && x.title.includes('Laravel/React'));
console.log('Keys of Laravel/React job:', Object.keys(j));
console.log('Details:', JSON.stringify(j, null, 2).slice(0, 1000));
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
