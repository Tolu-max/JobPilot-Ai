import { execSync } from 'node:child_process';
import fs from 'node:fs';

try {
  console.log('=== Checking ecosystem files on EC2 ===');
  const files = execSync('ls -la /home/ubuntu/jobpilot/*.cjs /home/ubuntu/jobpilot/*.js /home/ubuntu/jobpilot/*.json 2>/dev/null', { encoding: 'utf8' });
  console.log(files);
} catch (e) {
  console.log('Error:', e.message);
}

try {
  const pm2Dump = execSync('cat /home/ubuntu/.pm2/dump.pm2 2>/dev/null', { encoding: 'utf8' });
  const dump = JSON.parse(pm2Dump);
  const app12 = dump.find(a => a.pm_id === 12 || a.name === 'jobpilot-scheduler');
  if (app12) {
    console.log('app12 max_memory_restart:', app12.max_memory_restart);
    console.log('app12 node_args:', app12.node_args);
    console.log('app12 script:', app12.pm_exec_path);
  }
} catch (e) {
  console.log('Error reading dump.pm2:', e.message);
}
