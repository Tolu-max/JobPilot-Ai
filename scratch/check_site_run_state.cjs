const cp = require('child_process');

const remoteScript = `
const fs = require('fs');

function checkState(profile) {
  console.log('=== SITE RUN STATE FOR ' + profile.toUpperCase() + ' ===');
  try {
    const raw = fs.readFileSync('/app/data/profiles/' + profile + '/siteRunState.json', 'utf8');
    const state = JSON.parse(raw);
    const sites = state.sites || {};
    const rows = Object.entries(sites).map(([name, s]) => ({
      site: name,
      status: s.lastStatus,
      jobCount: s.lastJobCount,
      lastRunAt: s.lastRunAt,
      error: s.lastError || ''
    }));
    rows.sort((a,b) => (b.jobCount || 0) - (a.jobCount || 0));
    console.table(rows);
  } catch (e) {
    console.log('Could not read state for ' + profile + ': ' + e.message);
  }
}

checkState('tolu');
checkState('sister');
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
