import { execSync } from 'node:child_process';

console.log('=== Checking PM2 Logs around restarts ===');
try {
  const errLog = execSync('tail -n 40 /home/ubuntu/.pm2/logs/jobpilot-scheduler-error.log', { encoding: 'utf8' });
  console.log('--- ERROR LOG ---:\n' + errLog);
} catch (e) {
  console.log('Err:', e.message);
}

try {
  const pm2Logs = execSync('tail -n 40 /home/ubuntu/.pm2/pm2.log', { encoding: 'utf8' });
  console.log('--- PM2 DAEMON LOG ---:\n' + pm2Logs);
} catch (e) {
  console.log('PM2 daemon log:', e.message);
}
