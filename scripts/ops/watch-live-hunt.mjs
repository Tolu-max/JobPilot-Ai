import { execSync } from 'node:child_process';
import fs from 'node:fs';

const toluPrefs = JSON.parse(fs.readFileSync('profiles/tolu/preferences.json', 'utf8'));
const sisterPrefs = JSON.parse(fs.readFileSync('profiles/sister/preferences.json', 'utf8'));

console.log('=== Profile Configuration Check ===');
console.log(`Tolu enabled sites (${toluPrefs.enabledSites.length}):`, toluPrefs.enabledSites.join(', '));
console.log(`Sister enabled sites (${sisterPrefs.enabledSites.length}):`, sisterPrefs.enabledSites.join(', '));

console.log('\n=== Recent Scheduler Logs ===');
try {
  const pm2Logs = execSync('pm2 logs 12 --lines 40 --nostream', { encoding: 'utf8' });
  console.log(pm2Logs.trim());
} catch (e) {
  console.log('Error reading logs:', e.message);
}
