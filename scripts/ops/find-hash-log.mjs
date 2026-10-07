import { execSync } from 'node:child_process';

const out = execSync('grep -C 5 "9dbf3637bca6d436" /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log || true', { encoding: 'utf8' });
console.log('=== Telegram Log matches ===\n' + out);
