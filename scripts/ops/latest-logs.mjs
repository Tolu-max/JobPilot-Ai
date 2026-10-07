import { execSync } from 'node:child_process';

const out = execSync('tail -n 40 /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' });
console.log('=== LATEST SCHEDULER LOGS ===\n' + out);
