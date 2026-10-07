import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';

async function testWait() {
  const cookies = await loadIndeedCookies('tolu');
  const browser = await chromium.launch({
    headless: true,
    args: stealthArgs.filter(a => a !== '--no-startup-window' && a !== '--silent')
  });
  const ctx = await browser.newContext({
    userAgent: stealthUserAgent,
    viewport: { width: 1366, height: 768 }
  });
  await ctx.addInitScript(getStealthScript());
  if (cookies?.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  console.log('Navigating to job...');
  await page.goto('https://www.indeed.com/viewjob?jk=e58be4fcea83450d', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('Title:', await page.title());
  const frames = page.frames().map(f => f.url());
  console.log('Frames:', frames);
  const turnstileCount = await page.locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').count();
  console.log('Turnstile iframes count:', turnstileCount);
  const text = await page.locator('body').innerText().catch(() => '');
  console.log('Body text snippet:', text.slice(0, 300).replace(/\n/g, ' '));
  await browser.close();
}

testWait().catch(console.error);
