// Capture a logged-in Jobberman session into a profile's persistent browser dir.
//
// Jobberman's apply form requires an authenticated jobseeker account. The apply
// flow reuses chromium.launchPersistentContext(config.browserProfileDir), so once
// you log in here the cookies persist there and auto-apply can pass the login wall.
//
// Usage (run LOCALLY, needs a display — it opens a real browser):
//   node scripts/capture-jobberman-login.mjs sister
//   node scripts/capture-jobberman-login.mjs tolu
//
// Then sync the resulting browser-profile dir to the Railway volume (see README
// note printed at the end) so the live runner uses the same session.
import readline from 'node:readline';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';

const profile = process.argv[2];
if (!profile) {
  console.error('Usage: node scripts/capture-jobberman-login.mjs <profile>');
  process.exit(1);
}

const config = buildConfig([process.argv[0], 'jobpilot', `--profile=${profile}`]);
const dir = config.browserProfileDir;
console.log(`\nProfile: ${profile}`);
console.log(`Browser profile dir: ${dir}\n`);

const context = await chromium.launchPersistentContext(dir, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled']
});

const page = context.pages()[0] || (await context.newPage());
await page.goto('https://www.jobberman.com/seeker/login', { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('A browser window is open. Log into Jobberman as this candidate.');
console.log('When you can see the jobseeker dashboard, come back here and press Enter to save.\n');

await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Press Enter once logged in... ', () => {
    rl.close();
    resolve();
  });
});

await context.close();
console.log(`\n✓ Session saved to ${dir}`);
console.log('Next: sync that folder into the Railway volume at /app/data/browser-profiles/' + profile);
console.log('(e.g. tar it up and untar over railway ssh), then redeploy.');
