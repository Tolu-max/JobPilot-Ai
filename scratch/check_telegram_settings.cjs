const cp = require('child_process');

const remoteScript = `
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));
console.log('Tolu minReviewScore:', prefs.minReviewScore);
console.log('Tolu telegramReviewMinScore:', prefs.telegramReviewMinScore);
console.log('Tolu autoApplyScoreThreshold:', prefs.autoApplyScoreThreshold);
console.log('Tolu telegramReviewMode:', prefs.telegramReviewMode);
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
