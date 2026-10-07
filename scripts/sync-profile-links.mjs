import fs from 'node:fs';

// Keep user-controlled portfolio links current on persistent Railway volumes.
// Only the known retired URL is rewritten; other profile content is preserved.
const replacements = new Map([
  ['https://tolu.tconnect.com.ng', 'https://toluoyelola.cv']
]);

const profileDir = process.env.JOBPILOT_PROFILE_DATA_DIR || '/app/data/profiles';
const files = [
  `${profileDir}/tolu/masterCareerProfile.json`,
  `${profileDir}/tolu/candidateProfile.json`,
  `${profileDir}/tolu/cv-data.json`
];

for (const filePath of files) {
  if (!fs.existsSync(filePath)) continue;
  const before = fs.readFileSync(filePath, 'utf8');
  let after = before;
  for (const [oldUrl, newUrl] of replacements) after = after.replaceAll(oldUrl, newUrl);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`[profile-sync] Updated portfolio link in ${filePath}`);
  }
}
