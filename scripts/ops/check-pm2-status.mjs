import { execSync } from 'node:child_process';

const pm2Info = execSync('pm2 describe 12', { encoding: 'utf8' });
console.log(pm2Info);
