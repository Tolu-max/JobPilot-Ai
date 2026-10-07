import { execSync } from 'node:child_process';

const out = execSync('grep "Starting scraper pass for tolu" /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' });
console.log('=== All scraper runs for tolu ===\n' + out);
