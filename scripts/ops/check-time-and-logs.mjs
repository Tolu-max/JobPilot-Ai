import { execSync } from 'node:child_process';

console.log('Current server time:', execSync('date', { encoding: 'utf8' }).trim());
console.log('\nLatest 20 lines of scheduler log:');
console.log(execSync('tail -n 20 /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' }));
