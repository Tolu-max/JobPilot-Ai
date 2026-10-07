import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function checkBodyText() {
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
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('Matches /cloudflare/i:', /cloudflare/i.test(bodyText));
  console.log('Matches /just a moment/i:', /just a moment/i.test(bodyText));
  console.log('Matches /security service/i:', /security service to protect against malicious bots/i.test(bodyText));

  const allMatches = bodyText.match(/cloudflare/gi);
  console.log('Cloudflare matches in normal page bodyText:', allMatches);

  await browser.close();
}

checkBodyText().catch(console.error);
