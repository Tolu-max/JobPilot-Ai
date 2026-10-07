import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';
import { stealthArgs, stealthUserAgent } from '../src/stealthInit.js';

const profile = process.argv.find((arg) => arg.startsWith('--profile='))?.split('=').slice(1).join('=') || 'tolu';
const submitMode = process.argv.find((arg) => arg.startsWith('--submitMode='))?.split('=').slice(1).join('=') || 'click';
const screenshots = !process.argv.includes('--no-screenshots');
const config = buildConfig(['node', 'jobpilot', `--profile=${profile}`]);
const outDir = path.resolve('debug', `jobberman-login-${profile}`);

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, args: stealthArgs });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, userAgent: stealthUserAgent });

try {
  await page.goto('https://www.jobberman.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  await acceptCookies(page);
  const loginLink = page.locator('[data-cy="login-button-navbar"], a[href*="/account/login"]').first();
  if (await loginLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      loginLink.click({ force: true })
    ]);
  } else {
    await page.goto('https://www.jobberman.com/account/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await page.waitForTimeout(3000);
  await acceptCookies(page);
  if (screenshots) await page.screenshot({ path: path.join(outDir, '01-login.png'), fullPage: true, timeout: 10000 }).catch(() => {});

  console.log('loginUrl', page.url());
  console.log('hasEmail', Boolean(config.jobbermanEmail));
  console.log('hasPassword', Boolean(config.jobbermanPassword));
  console.log('inputs', await inputSnapshot(page));
  console.log('buttons', await buttonSnapshot(page));
  console.log('forms', await formSnapshot(page));
  console.log('cookiesBeforeSubmit', await cookieSnapshot(page));

  await page
    .locator('input[type="email"], input[name="username"], input[name="email"], #username, #email, input[autocomplete="username"], input[autocomplete="email"]')
    .first()
    .fill(config.jobbermanEmail);
  await page
    .locator('input[type="password"], input[name="password"], #password')
    .first()
    .fill(config.jobbermanPassword);
  await page.waitForTimeout(15000);

  if (submitMode === 'enter') {
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
      page.locator('input[type="password"], input[name="password"], #password').first().press('Enter')
    ]);
  } else if (submitMode === 'form') {
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
      page.locator('form').first().evaluate((form) => form.requestSubmit ? form.requestSubmit() : form.submit())
    ]);
  } else {
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
      page.getByRole('button', { name: /log ?in|sign ?in|continue|submit/i }).first().click({ force: true })
    ]);
  }
  await page.waitForTimeout(5000);
  if (screenshots) await page.screenshot({ path: path.join(outDir, '02-after-login.png'), fullPage: true, timeout: 10000 }).catch(() => {});

  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  console.log('afterUrl', page.url());
  console.log('loginNavVisible', await page.locator('[data-cy="login-button-navbar"], a[href*="/account/login"]').first().isVisible({ timeout: 1000 }).catch(() => false));
  console.log('cookiesAfterSubmit', await cookieSnapshot(page));
  console.log('bodyHead', body.slice(0, 1000).replace(/\s+/g, ' '));
} finally {
  await browser.close();
}

async function formSnapshot(page) {
  return page.locator('form').evaluateAll((forms) =>
    forms.map((form) => ({
      action: form.getAttribute('action'),
      method: form.getAttribute('method'),
      id: form.id,
      text: form.innerText.slice(0, 300)
    }))
  );
}

async function cookieSnapshot(page) {
  const cookies = await page.context().cookies('https://www.jobberman.com');
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    expires: cookie.expires,
    session: cookie.expires === -1
  }));
}

async function acceptCookies(page) {
  const accept = page.getByRole('button', { name: /accept all cookies|accept all/i }).first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function inputSnapshot(page) {
  return page.locator('input').evaluateAll((inputs) =>
    inputs.map((input) => ({
      type: input.getAttribute('type'),
      name: input.getAttribute('name'),
      id: input.id,
      placeholder: input.getAttribute('placeholder'),
      autocomplete: input.getAttribute('autocomplete'),
      visible: Boolean(input.offsetWidth || input.offsetHeight || input.getClientRects().length)
    }))
  );
}

async function buttonSnapshot(page) {
  return page.locator('button, input[type="submit"]').evaluateAll((buttons) =>
    buttons.slice(0, 20).map((button) => ({
      text: button.innerText || button.value || '',
      type: button.getAttribute('type'),
      name: button.getAttribute('name'),
      aria: button.getAttribute('aria-label'),
      visible: Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length)
    }))
  );
}
