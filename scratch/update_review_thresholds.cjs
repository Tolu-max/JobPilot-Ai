const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));

prefs.minReviewScore = 50;
prefs.telegramReviewMinScore = 50;
prefs.telegramReviewMode = 'instant';

fs.writeFileSync('/app/data/profiles/tolu/preferences.json', JSON.stringify(prefs, null, 2), 'utf8');
console.log('SUCCESS: Updated Tolu review thresholds on Railway!');
console.log('minReviewScore:', prefs.minReviewScore);
console.log('telegramReviewMinScore:', prefs.telegramReviewMinScore);
console.log('telegramReviewMode:', prefs.telegramReviewMode);
console.log('autoApplyScoreThreshold:', prefs.autoApplyScoreThreshold);
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
