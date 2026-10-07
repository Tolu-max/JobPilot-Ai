const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const toluPrefs = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));
const sisterPrefs = JSON.parse(fs.readFileSync('/app/data/profiles/sister/preferences.json', 'utf8'));

console.log('Tolu enabled sites (' + toluPrefs.enabledSites.length + '):', toluPrefs.enabledSites.join(', '));
console.log('Sister enabled sites (' + sisterPrefs.enabledSites.length + '):', sisterPrefs.enabledSites.join(', '));

const allImplemented = [
  'arbeitnow', 'ashby', 'bamboohr', 'breezyhr', 'bruntwork', 'dailyremote',
  'greenhouse', 'himalayas', 'hotnigerianjobs', 'influx', 'jobberman', 'jobicy',
  'lever', 'myjobmag', 'realworkfromanywhere', 'remotejobsorg', 'remoteok',
  'remotive', 'smartrecruiters', 'themuse', 'wellfound', 'weworkremotely',
  'workable', 'workingnomads'
];

console.log('Missing from Tolu:', allImplemented.filter(s => !toluPrefs.enabledSites.includes(s)));
console.log('Missing from Sister:', allImplemented.filter(s => !sisterPrefs.enabledSites.includes(s)));
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
