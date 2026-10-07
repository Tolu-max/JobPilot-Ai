import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../src/stealthInit.js';

const profile = process.argv.find((arg) => arg.startsWith('--profile='))?.split('=').slice(1).join('=') || process.env.PROFILE || 'sister';
const jobUrl = process.argv.find((arg) => arg.startsWith('--job-url='))?.split('=').slice(1).join('=');
const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
const debugDir = path.resolve(config.debugRootDir, config.profileName, 'himalayas-auth-check');

if (!config.himalayasEmail || !config.himalayasPassword) {
  console.error(`Missing ${profile.toUpperCase()}_HIMALAYAS_EMAIL or ${profile.toUpperCase()}_HIMALAYAS_PASSWORD.`);
  process.exit(1);
}

await fs.mkdir(debugDir, { recursive: true });

const context = await chromium.launchPersistentContext(config.himalayasBrowserProfileDir, {
  headless: config.headless,
  viewport: { width: 1366, height: 900 },
  userAgent: stealthUserAgent,
  args: [...stealthArgs, '--disable-gpu', '--log-level=3'],
  locale: 'en-US',
  timezoneId: 'Africa/Lagos'
});
await context.addInitScript(getStealthScript());

try {
  const page = await context.newPage();
  await login(page, config);
  await save(page, '01-after-login');
  const homeText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  console.log(`Logged in as ${config.himalayasEmail}; current URL: ${page.url()}`);
  console.log(homeText.slice(0, 500).replace(/\s+/g, ' '));

  if (jobUrl) {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);
    await save(page, '02-job-page');
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (isCloudflare(text)) {
      console.log('Himalayas job page is still blocked by Cloudflare after login. Keep this job in manual review unless a direct ATS URL is discovered.');
    } else {
      console.log(`Job page loaded: ${page.url()}`);
      console.log(text.slice(0, 1000).replace(/\s+/g, ' '));
    }
  }
} finally {
  await context.close();
}

async function login(page, cfg) {
  await page.goto('https://himalayas.app/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (await page.locator('text=Dashboard').first().isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }

  await page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first().fill(cfg.himalayasEmail);
  await page.locator('input[type="password"], input[name*="password" i], input[placeholder*="password" i]').first().fill(cfg.himalayasPassword);
  await page.locator('button:has-text("Log in"), button[type="submit"]').last().click({ force: true });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
}

async function save(page, label) {
  await page.screenshot({ path: path.join(debugDir, `${label}.png`), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(debugDir, `${label}.html`), await page.content().catch(() => ''), 'utf8').catch(() => {});
}

function isCloudflare(text) {
  return /security verification|malicious bots|performance and security by cloudflare/i.test(String(text || ''));
}
