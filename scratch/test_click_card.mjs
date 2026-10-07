import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testClickCard() {
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
  console.log('Navigating to Indeed search...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  // Click on the first job card on the search page itself
  console.log('Clicking the first job card...');
  const card = page.locator('.job_seen_beacon, [data-jk]').first();
  await card.click();
  await page.waitForTimeout(3000);

  console.log('Search page title after click:', await page.title());
  console.log('Search page URL after click:', page.url());

  // Check the apply buttons in the right-hand preview pane:
  const applyButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('#indeedApplyButton, #applyButtonLinkContainer a, [data-testid="apply-button"], [id*="apply" i]'));
    return btns.map(b => ({
      id: b.id,
      text: b.innerText?.trim(),
      href: b.getAttribute('href'),
      tag: b.tagName
    }));
  });

  console.log('Found apply buttons in pane:', JSON.stringify(applyButtons, null, 2));

  await browser.close();
}

testClickCard().catch(console.error);
