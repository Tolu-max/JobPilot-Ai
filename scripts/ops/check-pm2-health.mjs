import { execSync } from 'node:child_process';

const list = execSync('pm2 jlist', { encoding: 'utf8' });
const procs = JSON.parse(list);
for (const p of procs) {
  console.log(`[PM2] id=${p.pm_id} name=${p.name} status=${p.pm2_env.status} restarts=${p.pm2_env.restart_time} uptime=${Math.round((Date.now() - p.pm2_env.pm_uptime)/1000/60)}m memory=${Math.round(p.monit.memory/1024/1024)}MB cpu=${p.monit.cpu}%`);
}
