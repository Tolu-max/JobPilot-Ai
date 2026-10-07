import fs from 'node:fs';
import path from 'node:path';

const dirs = [
  '/home/ubuntu/jobpilot/browser-profiles/sister/Default/Cache',
  '/home/ubuntu/jobpilot/browser-profiles/sister/Default/Code Cache',
  '/home/ubuntu/jobpilot/browser-profiles/tolu/Default/Cache',
  '/home/ubuntu/jobpilot/browser-profiles/tolu/Default/Code Cache',
  '/home/ubuntu/jobpilot/debug'
];

dirs.forEach(d => {
  try {
    fs.rmSync(d, { recursive: true, force: true });
    console.log('Removed directory:', d);
  } catch (e) {
    console.error('Error removing ' + d + ':', e.message);
  }
});

const logDirs = ['/home/ubuntu/jobpilot/logs', '/home/ubuntu/jobpilot/events'];
logDirs.forEach(ld => {
  try {
    if (!fs.existsSync(ld)) return;
    const files = fs.readdirSync(ld);
    files.forEach(f => {
      const fp = path.join(ld, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.size > 200000) {
          const content = fs.readFileSync(fp, 'utf8');
          const lines = content.split('\n');
          const kept = lines.slice(-200).join('\n');
          fs.writeFileSync(fp, kept);
          console.log(`Truncated ${fp}: ${stat.size} -> ${Buffer.byteLength(kept)} bytes`);
        }
      } catch (err) {
        console.error('Error on file ' + fp + ':', err.message);
      }
    });
  } catch (e) {
    console.error('Error on dir ' + ld + ':', e.message);
  }
});

console.log('Cleanup complete.');
