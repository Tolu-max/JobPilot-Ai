import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testIgnore() {
  const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: stealthArgs.filter(a => a !== '--no-startup-window' && a !== '--silent')
  });
  const ctx = await browser.newContext({
    userAgent: stealthUserAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  await ctx.addInitScript(getStealthScript());

  const page = await ctx.newPage();
  console.log('Testing with ignoreDefaultArgs: ["--enable-automation"]...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(4000);

  console.log('Title:', await page.title());
  console.log('URL:', page.url());

  const scriptText = await page.evaluate(() => document.getElementById('mosaic-data')?.textContent || '');
  console.log('Mosaic text length:', scriptText.length);

  await browser.close();
}

testIgnore().catch(console.error);
