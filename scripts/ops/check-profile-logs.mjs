import { execSync } from 'node:child_process';

console.log('=== logs/tolu.log (latest 30 lines) ===');
try {
  const tolu = execSync('tail -n 30 /home/ubuntu/jobpilot/logs/tolu.log 2>/dev/null', { encoding: 'utf8' });
  console.log(tolu);
} catch (e) {
  console.log('Error reading tolu log:', e.message);
}

console.log('=== logs/sister.log (latest 30 lines) ===');
try {
  const sister = execSync('tail -n 30 /home/ubuntu/jobpilot/logs/sister.log 2>/dev/null', { encoding: 'utf8' });
  console.log(sister);
} catch (e) {
  console.log('Error reading sister log:', e.message);
}
