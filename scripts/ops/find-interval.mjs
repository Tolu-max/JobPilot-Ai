import { execSync } from 'node:child_process';

console.log('=== First 30 lines of out.log ===');
console.log(execSync('head -n 30 /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' }));

console.log('=== Tail of jobpilot.log ===');
console.log(execSync('tail -n 30 /home/ubuntu/jobpilot/jobpilot.log || true', { encoding: 'utf8' }));
