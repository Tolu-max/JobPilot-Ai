import { execSync } from 'node:child_process';

// wait 25s
await new Promise(r => setTimeout(r, 25000));
console.log('Server time:', execSync('date', { encoding: 'utf8' }).trim());
console.log('\nLatest 30 lines of scheduler log:');
console.log(execSync('tail -n 30 /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' }));
