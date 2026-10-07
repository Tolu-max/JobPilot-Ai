import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testWithCookies() {
  const config = buildConfig(['node', 'test', '--profile=tolu']);
  const cookies = await loadIndeedCookies('tolu', config);
  console.log(`Loaded ${cookies?.length} cookies from loadIndeedCookies.`);

  const browser = await chromium.launch({
    headless: true,
    args: stealthArgs.filter(a => a !== '--no-startup-window' && a !== '--silent')
  });
  const context = await browser.newContext({
    userAgent: stealthUserAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  await context.addInitScript(getStealthScript());

  if (cookies?.length) {
    await context.addCookies(cookies);
    console.log('Cookies injected into browser context.');
  }

  const page = await context.newPage();
  console.log('Navigating to Indeed home...');
  await page.goto('https://www.indeed.com', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);
  console.log('Home title:', await page.title());
  console.log('Home URL:', page.url());

  const navAccount = await page.evaluate(() => {
    const el = document.querySelector('[data-gnav-element-name="AccountMenu"], [data-testid="account-menu"], [aria-label*="account" i]');
    return el ? el.innerText?.trim() : 'no account menu';
  });
  console.log('Account menu element:', navAccount);

  console.log('Navigating to job view...');
  await page.goto('https://www.indeed.com/viewjob?jk=42628e5727f93d27', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);
  console.log('Job view URL:', page.url());
  console.log('Job view title:', await page.title());

  await browser.close();
}

testWithCookies().catch(console.error);
