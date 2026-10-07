import fs from 'node:fs';
import { execSync } from 'node:child_process';

console.log('=== Checking JSON Preferences on EC2 ===');
JSON.parse(fs.readFileSync('profiles/tolu/preferences.json', 'utf8'));
JSON.parse(fs.readFileSync('profiles/sister/preferences.json', 'utf8'));
console.log('Both Tolu and Sister preferences JSON are valid!');

console.log('=== Checking Scrapers on EC2 ===');
const checkOut = execSync('npm run scrapers:check', { encoding: 'utf8' });
console.log(checkOut.trim());

console.log('=== Restarting PM2 process 12 ===');
const pm2Restart = execSync('pm2 restart 12 --update-env', { encoding: 'utf8' });
console.log(pm2Restart.trim());
