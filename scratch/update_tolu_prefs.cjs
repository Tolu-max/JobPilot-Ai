const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));

// 1. Update allowedLocations: remove lagos, ensure ibadan, abuja, oyo, fct, remote, nigeria
prefs.allowedLocations = ['remote', 'ibadan', 'abuja', 'oyo', 'fct', 'nigeria'];
prefs.relocationLocations = ['ibadan', 'abuja', 'oyo', 'fct'];

// 2. Update jobberman site config to explicit verified jobsUrls (Ibadan, Abuja, Software, Creative Design)
prefs.sites = prefs.sites || {};
prefs.sites.jobberman = {
  enabled: true,
  maxJobsPerRun: 40,
  maxAgeDays: 30,
  cooldownMinutes: 1,
  rescanRecentJobs: true,
  autoApplyEnabled: true,
  detailScanLimit: 60,
  remoteOnly: false,
  jobsUrls: [
    "https://www.jobberman.com/jobs/software-data",
    "https://www.jobberman.com/jobs/software-data/remote",
    "https://www.jobberman.com/jobs/software-data?location=ibadan",
    "https://www.jobberman.com/jobs/software-data/abuja?location=abuja",
    "https://www.jobberman.com/jobs/creative-design",
    "https://www.jobberman.com/jobs?location=ibadan",
    "https://www.jobberman.com/jobs/abuja?location=abuja"
  ]
};

// 3. Update myjobmag site config to explicit verified jobsUrls
prefs.sites.myjobmag = {
  enabled: true,
  maxJobsPerRun: 30,
  maxAgeDays: 14,
  cooldownMinutes: 1,
  autoApplyEnabled: true,
  remoteOnly: false,
  jobsUrls: [
    "https://www.myjobmag.com/jobs-by-type/remote",
    "https://www.myjobmag.com/jobs-by-field/information-technology",
    "https://www.myjobmag.com/jobs-location/oyo",
    "https://www.myjobmag.com/jobs-location/abuja"
  ]
};

// 4. Add realworkfromanywhere and dailyremote to enabledSites
const toAdd = ['realworkfromanywhere', 'dailyremote'];
for (const s of toAdd) {
  if (!prefs.enabledSites.includes(s)) {
    prefs.enabledSites.push(s);
  }
}

// 5. Write back to /app/data/profiles/tolu/preferences.json
fs.writeFileSync('/app/data/profiles/tolu/preferences.json', JSON.stringify(prefs, null, 2), 'utf8');
console.log('SUCCESS: Tolu preferences updated on Railway!');
console.log('allowedLocations:', prefs.allowedLocations);
console.log('enabledSites count:', prefs.enabledSites.length);
console.log('jobberman jobsUrls:', prefs.sites.jobberman.jobsUrls.length);
console.log('myjobmag jobsUrls:', prefs.sites.myjobmag.jobsUrls.length);
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
