import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const failures = [];

await assertJson('package.json');
await assertJson('config/sites.json');
await assertEnvExample();
await assertNoPrivateApplicantFiles();

if (failures.length > 0) {
  console.error('Release check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Release check passed.');
}

async function assertJson(relativePath) {
  try {
    JSON.parse(await fs.readFile(path.join(rootDir, relativePath), 'utf8'));
  } catch (error) {
    failures.push(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

async function assertEnvExample() {
  const raw = await fs.readFile(path.join(rootDir, '.env.example'), 'utf8').catch(() => '');
  if (!raw) {
    failures.push('.env.example is missing.');
    return;
  }
  const riskyPatterns = [
    /AIza[0-9A-Za-z_-]{20,}/,
    /xox[baprs]-[0-9A-Za-z-]+/,
    /[0-9]{8,}:[A-Za-z0-9_-]{20,}/
  ];
  if (riskyPatterns.some((pattern) => pattern.test(raw))) {
    failures.push('.env.example appears to contain a real secret.');
  }
}

async function assertNoPrivateApplicantFiles() {
  const riskyFiles = [];
  const rootEntries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && isPrivateApplicantFile(entry.name)) {
      riskyFiles.push(entry.name);
    }
  }

  const profilesDir = path.join(rootDir, 'profiles');
  const profiles = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  for (const profile of profiles) {
    if (!profile.isDirectory()) continue;
    if (profile.name === 'example') continue;
    const profileDir = path.join(profilesDir, profile.name);
    const files = await fs.readdir(profileDir).catch(() => []);
    for (const file of files) {
      if (/resume\.(pdf|docx|txt)$/i.test(file) || isPrivateApplicantFile(file)) {
        riskyFiles.push(path.join('profiles', profile.name, file));
      }
    }
  }

  if (riskyFiles.length > 0) {
    failures.push(`Private applicant files are present and should not be published: ${riskyFiles.join(', ')}`);
  }
}

function isPrivateApplicantFile(fileName) {
  return /\.(pdf|docx|m4a|mp3|wav)$/i.test(fileName);
}
