import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testCleanCookies() {
  const config = buildConfig(['node', 'test', '--profile=tolu']);
  const allCookies = await loadIndeedCookies('tolu', config);
  const now = Date.now() / 1000;

  // Filter out expired cookies and Cloudflare cookies (Cloudflare tokens should be freshly negotiated)
  const validCookies = (allCookies || []).filter(c => {
    if (c.name.includes('cf_') || c.name.includes('_cf')) return false;
    if (c.expirationDate && c.expirationDate < now) return false;
    return true;
  });

  console.log(`Filtered from ${allCookies?.length} down to ${validCookies.length} valid session cookies.`);
  console.log('Kept cookies:', validCookies.map(c => c.name));

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

  if (validCookies.length) {
    await context.addCookies(validCookies);
  }

  const page = await context.newPage();
  console.log('Navigating to ng.indeed.com...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);
  console.log('ng.indeed title:', await page.title());

  await browser.close();
}

testCleanCookies().catch(console.error);
