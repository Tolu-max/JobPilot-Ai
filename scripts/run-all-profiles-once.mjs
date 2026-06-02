import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJobHunt } from '../src/pipeline.js';
import { buildConfig } from '../src/config.js';
import { appendLog } from '../src/logger.js';
import { checkEmailResponses } from '../src/responseTracker.js';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const profilesDir = path.join(rootDir, 'profiles');

const requested = (process.env.PROFILES || process.env.PROFILE || '')
  .split(',')
  .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
  .filter(Boolean);

const profileNames = requested.length ? requested : await discoverProfiles();

if (!profileNames.length) {
  console.log('No profiles found. Add profiles under /app/data/profiles or set PROFILES.');
  process.exit(0);
}

let failures = 0;

for (const profileName of profileNames) {
  const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profileName}`]);
  console.log(`\nJobPilot cron pass: ${profileName}`);

  try {
    await appendLog('Railway cron pass started.', config);
    await runJobHunt(config);
    await checkEmailResponses(config).catch((err) => appendLog(`ResponseTracker error: ${err.message}`, config));
    await appendLog('Railway cron pass finished.', config);
  } catch (err) {
    failures += 1;
    await appendLog(`Railway cron pass failed: ${err.stack || err.message}`, config);
    console.error(`Profile ${profileName} failed: ${err.message}`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

async function discoverProfiles() {
  try {
    const names = await fs.readdir(profilesDir);
    return names.filter((name) => !name.startsWith('.') && name !== 'example');
  } catch {
    return [];
  }
}
