import { execSync } from 'node:child_process';

console.log('=== Reloading PM2 with new ecosystem config ===');
try {
  execSync('pm2 delete 12', { stdio: 'inherit' });
} catch {}

const out = execSync('pm2 start ecosystem.config.cjs', { encoding: 'utf8' });
console.log(out);

execSync('pm2 save', { stdio: 'inherit' });
console.log('PM2 configuration saved!');
