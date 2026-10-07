import { execSync } from 'node:child_process';

const files = [
  ['src/pipeline.js', '/home/ubuntu/jobpilot/src/pipeline.js'],
  ['src/scheduler.js', '/home/ubuntu/jobpilot/src/scheduler.js'],
  ['ecosystem.config.cjs', '/home/ubuntu/jobpilot/ecosystem.config.cjs'],
  ['src/telegramBot.js', '/home/ubuntu/jobpilot/src/telegramBot.js'],
  ['src/scrapers/greenhouse.js', '/home/ubuntu/jobpilot/src/scrapers/greenhouse.js'],
  ['src/scrapers/index.js', '/home/ubuntu/jobpilot/src/scrapers/index.js'],
  ['profiles/tolu/preferences.json', '/home/ubuntu/jobpilot/profiles/tolu/preferences.json'],
  ['profiles/sister/preferences.json', '/home/ubuntu/jobpilot/profiles/sister/preferences.json'],
  ['test/telegramRedesignFormat.test.js', '/home/ubuntu/jobpilot/test/telegramRedesignFormat.test.js']
];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (const [src, dest] of files) {
  let ok = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const cmd = `scp -B -i C:/Users/USA/.ssh/aws-ec2.pem -o StrictHostKeyChecking=no "${src}" "ubuntu@13.60.173.41:${dest}"`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`[Attempt ${attempt}] Uploaded ${src} -> ${dest}`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`[Attempt ${attempt}] Failed ${src}: ${e.message}`);
      sleep(2000);
    }
  }
  if (!ok) {
    throw new Error(`Failed to upload ${src} after 3 attempts`);
  }
}

console.log('All updates deployed to AWS EC2 successfully!');
