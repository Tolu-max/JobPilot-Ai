const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('/app/data/profiles/sister/preferences.json', 'utf8'));

// 1. Keep sister 100% remote
prefs.allowedLocations = ['remote'];
prefs.liveSubmitRemoteOnly = true;
prefs.allowHybrid = false;
prefs.willingToRelocate = false;

// 2. Add realworkfromanywhere and dailyremote
const toAdd = ['realworkfromanywhere', 'dailyremote'];
for (const s of toAdd) {
  if (!prefs.enabledSites.includes(s)) {
    prefs.enabledSites.push(s);
  }
}

// 3. Configure myjobmag remote for sister
prefs.sites = prefs.sites || {};
prefs.sites.myjobmag = {
  enabled: true,
  maxJobsPerRun: 25,
  maxAgeDays: 14,
  cooldownMinutes: 1,
  autoApplyEnabled: false,
  remoteOnly: true,
  jobsUrls: [
    "https://www.myjobmag.com/jobs-by-type/remote"
  ]
};

// 4. Configure jobberman remote support for sister
prefs.sites.jobberman = {
  enabled: true,
  maxJobsPerRun: 25,
  maxAgeDays: 30,
  cooldownMinutes: 1,
  autoApplyEnabled: false,
  remoteOnly: true,
  jobsUrls: [
    "https://www.jobberman.com/jobs/customer-service-support/remote",
    "https://www.jobberman.com/jobs/administrative-office/remote"
  ]
};

fs.writeFileSync('/app/data/profiles/sister/preferences.json', JSON.stringify(prefs, null, 2), 'utf8');
console.log('SUCCESS: Sister preferences updated on Railway!');
console.log('allowedLocations:', prefs.allowedLocations);
console.log('liveSubmitRemoteOnly:', prefs.liveSubmitRemoteOnly);
console.log('enabledSites count:', prefs.enabledSites.length);
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
