import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testEasyApply() {
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
  console.log('Navigating to Indeed job with Easy Apply...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date&vjk=8e08cdf56c4b7a59', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const applyBtn = page.locator('text="Apply now", [data-testid="apply-button"], [id*="indeedApply" i]').first();
  const isVisible = await applyBtn.isVisible().catch(() => false);
  console.log('Apply button visible:', isVisible);

  if (isVisible) {
    console.log('Clicking Apply button...');
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
      applyBtn.click()
    ]);

    const activePage = popup || page;
    await activePage.waitForTimeout(4000);
    console.log('Active page URL:', activePage.url());
    console.log('Active page title:', await activePage.title());

    const bodyText = await activePage.locator('body').innerText().catch(() => '');
    console.log('Active page snippet:', bodyText.substring(0, 300).replace(/\n/g, ' '));

    const buttons = await activePage.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"], a')).map(b => b.innerText?.trim()).filter(Boolean);
    });
    console.log('Buttons on active page:', buttons);
  }

  await browser.close();
}

testEasyApply().catch(console.error);
