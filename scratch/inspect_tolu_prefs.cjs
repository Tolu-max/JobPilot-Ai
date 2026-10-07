const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));
console.log('allowedLocations:', prefs.allowedLocations);
console.log('exclusions:', prefs.exclusions);
console.log('sites.jobberman:', JSON.stringify(prefs.sites ? prefs.sites.jobberman : null, null, 2));
console.log('sites.myjobmag:', JSON.stringify(prefs.sites ? prefs.sites.myjobmag : null, null, 2));
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
