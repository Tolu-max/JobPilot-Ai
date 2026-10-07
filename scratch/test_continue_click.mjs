import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testContinue() {
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
  }

  const page = await context.newPage();
  const applyUrl = "https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=0e740537-74e7-4764-9c44-79924a3c2939-ZnJhcHJvZDE&iaUid=1k3pa5767h84v801";
  await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(3000);

  console.log('Current URL before click:', page.url());

  const continueBtn = page.locator('button:has-text("Continue"), input[value="Continue"]').first();
  const visible = await continueBtn.isVisible().catch(() => false);
  console.log('Continue button visible:', visible);

  if (visible) {
    console.log('Clicking Continue...');
    await continueBtn.click();
    await page.waitForTimeout(4000);

    console.log('URL after click:', page.url());
    console.log('Title after click:', await page.title());

    const heading = await page.locator('h1, h2').allInnerTexts().catch(() => []);
    console.log('Headings:', heading);

    const btns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => b.innerText?.trim()).filter(Boolean);
    });
    console.log('Buttons:', btns);
  }

  await browser.close();
}

testContinue().catch(console.error);
