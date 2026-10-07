import fs from 'node:fs/promises';
import path from 'node:path';

const profile = String(process.argv.find((arg) => arg.startsWith('--profile=')) || '--profile=sister')
  .slice('--profile='.length)
  .trim()
  .toLowerCase();
const dataDir = process.env.JOBPILOT_DATA_DIR || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(process.cwd(), 'data'));
const logPath = path.join(dataDir, 'logs', `${profile}.log`);

try {
  const content = await fs.readFile(logPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const needles = /Submit Application stayed disabled|Visible incomplete|FAILED|MANUAL|Queued for manual review|Auto-apply attempt|Applied|apply/i;
  const matches = lines.filter((line) => needles.test(line));
  console.log(`[inspect-profile-log] ${profile}: ${matches.length} matching lines from ${logPath}`);
  for (const line of matches.slice(-80)) console.log(line);
} catch (error) {
  console.error(`[inspect-profile-log] unable to read ${logPath}: ${error.message}`);
  process.exitCode = 1;
}
