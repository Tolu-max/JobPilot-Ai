import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testAuthFollow() {
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

  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(3000);
    const title = await page.title();
    console.log(`[${i * 3}s] URL: ${page.url()} | Title: ${title}`);
    const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    console.log(`Snippet: ${body.substring(0, 150).replace(/\n/g, ' ')}`);
  }

  await browser.close();
}

testAuthFollow().catch(console.error);
