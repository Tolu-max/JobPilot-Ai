import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testTurnstile() {
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

  const page = await context.newPage();
  console.log('Navigating to Indeed...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  console.log('Title:', await page.title());
  
  // Find Turnstile frame
  const frames = page.frames();
  console.log(`Found ${frames.length} frames.`);
  for (const frame of frames) {
    const fUrl = frame.url();
    if (fUrl.includes('cloudflare') || fUrl.includes('turnstile')) {
      console.log('Found Turnstile frame:', fUrl);
      const checkbox = frame.locator('input[type="checkbox"], #challenge-stage, .ctp-checkbox-label').first();
      const visible = await checkbox.isVisible().catch(() => false);
      console.log('Checkbox visible:', visible);
      if (visible) {
        console.log('Clicking Turnstile checkbox...');
        await checkbox.click({ force: true }).catch(console.error);
        await page.waitForTimeout(5000);
        console.log('Title after click:', await page.title());
      }
    }
  }

  await browser.close();
}

testTurnstile().catch(console.error);
