import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testSmartUrl() {
  const config = buildConfig(['node', 'test', '--profile=tolu']);
  const cookies = await loadIndeedCookies('tolu', config);

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
    console.log(`Injected ${cookies.length} cookies.`);
  }

  const page = await context.newPage();
  const applyUrl = "https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=0e740537-74e7-4764-9c44-79924a3c2939-ZnJhcHJvZDE&iaUid=1k3pa5767h84v801";
  console.log('Navigating to smartapply url:', applyUrl);
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(4000);

  console.log('SmartApply current URL:', page.url());
  console.log('SmartApply title:', await page.title());

  const body = await page.locator('body').innerText().catch(() => '');
  console.log('Body length:', body.length);
  console.log('Body snippet:', body.substring(0, 300).replace(/\n/g, ' '));

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => b.innerText?.trim()).filter(Boolean);
  });
  console.log('Buttons:', buttons);

  await browser.close();
}

testSmartUrl().catch(console.error);
