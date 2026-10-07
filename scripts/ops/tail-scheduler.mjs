import { execSync } from 'node:child_process';

try {
  const out = execSync('tail -n 60 /home/ubuntu/.pm2/logs/jobpilot-scheduler-out.log', { encoding: 'utf8' });
  console.log('=== STDOUT (latest 60 lines) ===\n' + out);
} catch (e) {
  console.log('Error reading out log:', e.message);
}

try {
  const err = execSync('tail -n 25 /home/ubuntu/.pm2/logs/jobpilot-scheduler-error.log', { encoding: 'utf8' });
  console.log('=== STDERR (latest 25 lines) ===\n' + err);
} catch (e) {
  console.log('Error reading err log:', e.message);
}
