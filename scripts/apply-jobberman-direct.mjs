import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';
import { solveCaptchaAuto } from '../src/captchaSolver.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../src/stealthInit.js';

const args = parseArgs(process.argv.slice(2));
const profile = String(args.profile || 'tolu');
const url = String(args.url || '');
const title = String(args.title || 'Jobberman role');
const salary = String(args.salary || '');
const cover = String(args.cover || 'I am interested in this role because it matches my background and I can contribute with reliable communication, organization, and relevant experience.');

if (!url) {
  console.error('Missing --url');
  process.exit(1);
}

const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
const outDir = path.resolve('debug', `jobberman-direct-${profile}-${Date.now()}`);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [...stealthArgs, '--disable-gpu', '--log-level=3', '--silent-launch', '--no-startup-window']
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  userAgent: stealthUserAgent,
  locale: 'en-US',
  timezoneId: 'Africa/Lagos'
});
await context.addInitScript(getStealthScript());
const page = await context.newPage();

try {
  await goto(page, url);
  await settle(page, config);
  await loginIfNeeded(page, config, url);
  await goto(page, url);
  await settle(page, config);
  await openApplyPanel(page);
  await fillApplication(page, { salary, cover });
  await page.screenshot({ path: path.join(outDir, '01-before-submit.png'), fullPage: true }).catch(() => {});
  await submitApplication(page);
  await page.screenshot({ path: path.join(outDir, '02-after-submit.png'), fullPage: true }).catch(() => {});

  const body = await text(page);
  const result = {
    profile,
    title,
    url,
    currentUrl: page.url(),
    submitted: /application (sent|submitted|received)|successfully applied|you have applied|application successful/i.test(body),
    alreadyApplied: /you have applied|already applied/i.test(body),
    bodyHead: body.slice(0, 1200).replace(/\s+/g, ' '),
    debugDir: outDir
  };
  await fs.writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.submitted || result.alreadyApplied ? 0 : 2);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

async function goto(page, target) {
  await page.goto(target, { waitUntil: 'commit', timeout: 90000 });
  await page.waitForTimeout(5000);
}

async function settle(page, config) {
  await acceptCookies(page);
  if (await hasCaptcha(page)) {
    await solveCaptchaAuto(page, config).catch(() => null);
    await page.waitForTimeout(2000);
  }
}

async function loginIfNeeded(page, config, returnUrl) {
  if (!await hasLoginNav(page)) return;
  await page.goto('https://www.jobberman.com', { waitUntil: 'commit', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await acceptCookies(page);
  const login = page.locator('[data-cy="login-button-navbar"], a[href*="/account/login"]').first();
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
    login.click({ force: true })
  ]);
  await page.waitForTimeout(3000);
  await acceptCookies(page);
  await page
    .locator('input[type="email"], input[name="username"], input[name="email"], #username, #email, input[autocomplete="username"], input[autocomplete="email"]')
    .first()
    .fill(config.jobbermanEmail);
  const password = page.locator('input[type="password"], input[name="password"], #password').first();
  await password.fill(config.jobbermanPassword);
  await page.waitForTimeout(15000);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    password.press('Enter')
  ]);
  await page.waitForTimeout(5000);
  if (await hasLoginNav(page)) {
    throw new Error('Jobberman login did not complete.');
  }
  await page.goto(returnUrl, { waitUntil: 'commit', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

async function openApplyPanel(page) {
  if (await formVisible(page)) return;
  const buttons = page.locator('button[aria-label="Apply here"], button[title="Apply here"]');
  const count = await buttons.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = buttons.nth(index);
    if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) continue;
    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    if (await formVisible(page)) return;
  }
  await page.evaluate(() => {
    const globalStore = window.Alpine?.store?.('global');
    if (globalStore) globalStore.mobileApplyFormOpen = true;
  }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!await formVisible(page)) throw new Error('Jobberman application form did not open.');
}

async function fillApplication(page, { salary, cover }) {
  await acceptCookies(page);
  const salaryInput = page.locator('input[name="salary_expectation"], #salary_expectation').first();
  if (await salaryInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await salaryInput.fill(salary);
  }
  const cv = page.locator('select[name="uploaded_cv"]').first();
  if (await cv.isVisible({ timeout: 3000 }).catch(() => false)) {
    const current = await cv.inputValue().catch(() => '');
    if (!current) {
      const options = await cv.evaluate((el) => Array.from(el.options).map((option) => option.value).filter(Boolean)).catch(() => []);
      if (options[0]) await cv.selectOption(options[0]).catch(() => {});
    }
  }
  const coverLetter = page.locator('textarea[name="description"], #cover_letter_display').first();
  if (await coverLetter.isVisible({ timeout: 3000 }).catch(() => false)) {
    await coverLetter.fill(cover);
  }
}

async function submitApplication(page) {
  await acceptCookies(page);
  const submit = await visibleSubmitButton(page);
  if (!submit) throw new Error('Visible Jobberman Submit and apply button not found.');
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await submit.click({ force: true });
  await page.waitForTimeout(1500);
  const applyAnyway = page.getByRole('button', { name: /apply anyway/i }).first();
  if (await applyAnyway.isVisible({ timeout: 3000 }).catch(() => false)) {
    await applyAnyway.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(8000);
}

async function visibleSubmitButton(page) {
  const buttons = page.locator('button[aria-label="Submit and apply"], button[title="Submit and apply"], #btn-application-submit');
  const count = await buttons.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) return button;
  }
  return null;
}

async function formVisible(page) {
  return page.locator('input[name="salary_expectation"], #salary_expectation, textarea[name="description"], #cover_letter_display')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

async function hasLoginNav(page) {
  return page.locator('[data-cy="login-button-navbar"], a[href*="/account/login"]').first().isVisible({ timeout: 1000 }).catch(() => false);
}

async function acceptCookies(page) {
  const accept = page.getByRole('button', { name: /accept all cookies|accept all/i }).first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function hasCaptcha(page) {
  return page.locator('iframe[src*="recaptcha"], .g-recaptcha, textarea[name="g-recaptcha-response"]').first().isVisible({ timeout: 1000 }).catch(() => false);
}

async function text(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    parsed[key] = inline ?? argv[index + 1] ?? true;
    if (inline === undefined && argv[index + 1] && !argv[index + 1].startsWith('--')) index += 1;
  }
  return parsed;
}
