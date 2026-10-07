const cp = require('child_process');

const remoteScript = `
import { sendReviewNotification } from './src/telegramBot.js';
import { buildConfig } from './src/config.js';
import fs from 'node:fs';

async function main() {
  const config = buildConfig(['node', 'cli.js', '--profile=tolu']);
  const raw = fs.readFileSync('/app/data/profiles/tolu/processedJobs.json', 'utf8');
  const parsed = JSON.parse(raw);
  const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || Object.values(parsed));

  const targetTitles = [
    'Principal Software Architect',
    'Programming & Software Development Instructor',
    'Senior Backend Engineer',
    'Frontend Web Application Developer - Remote',
    'Sr. Full-Stack Software Engineer',
    'Lead PHP Developer',
    'Bare Developer (100% Remote - Worldwide) - C / JavaScript',
    'Senior UI/UX Designer',
    'Visual Designer - Web'
  ];

  const targets = jobs.filter(j => targetTitles.some(t => j.title && j.title.toLowerCase().includes(t.toLowerCase())));
  console.log('Found additional targets:', targets.length);

  for (const job of targets) {
    if (job.status === 'applied') continue;
    console.log('Sending review notification for:', job.title, 'Score:', job.score);
    job.status = 'reviewed';
    job.decision = 'review';
    await sendReviewNotification({
      ...job,
      url: job.job_url || job.url || job.applicationUrl,
      source: job.source_site || job.source || 'portal',
      reviewReason: 'Tech match score ' + job.score + '/100 (>50 manual review threshold).'
    }, job.score, config);
    console.log('Sent notification for:', job.title);
  }

  fs.writeFileSync('/app/data/profiles/tolu/processedJobs.json', JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Successfully updated additional job records to reviewed!');
}

main().catch(err => console.error(err));
`;

const b64 = Buffer.from(remoteScript).toString('base64');
const out = cp.execSync(`railway ssh -i "C:/Users/USA/.ssh/railway_cli_ed25519" -- "echo ${b64} | base64 -d | node --input-type=module"`, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: true
});
console.log(out);
