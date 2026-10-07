import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { getAdapter } from '../src/adapters/index.js';
import { buildConfig } from '../src/config.js';

async function testClick() {
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
  const url = "https://ng.indeed.com/rc/clk?jk=8e08cdf56c4b7a59&bb=tnNQkmvCEoU6yrOk-9cA_ASEPmx6wKnHvzMbrj6yiH5kWqzSNBOFI8ZmG4JqEU2C-eoV0OKeHgBjGr1y06MVq1qwcUHgHmOYYCnqaGZNdxLnugVRJz2sLEEoI41fxnHS&xkcb=SoDJ67M2e5cN1lT4lJ0LbzkdCdPP&fccid=f785c2b1d871efb7&cmp=i4-integrated-services&ti=PHP+Developer&vjs=3";
  console.log('Navigating to rc/clk url...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(2000);

  console.log('Final URL after goto:', page.url());
  console.log('Final Page title:', await page.title());

  const adapter = getAdapter(page.url());
  console.log('Matched adapter for final URL:', adapter.name);

  const step = await adapter.getCurrentStep(page, {});
  console.log('Current step:', step);

  await browser.close();
}

testClick().catch(console.error);
