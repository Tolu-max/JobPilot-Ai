import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testSmartApply() {
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
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date&vjk=8e08cdf56c4b7a59', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3500);

  const applyBtn = page.locator('text="Apply now", [data-testid="apply-button"]').first();
  console.log('Clicking Apply now...');
  await applyBtn.click();
  await page.waitForTimeout(4000);

  console.log('URL after click:', page.url());
  console.log('Title after click:', await page.title());

  const fields = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(i => ({
      name: i.name || i.id,
      type: i.type,
      label: i.labels?.[0]?.innerText?.trim()
    }));
    return inputs;
  });

  console.log('Form fields found:', JSON.stringify(fields, null, 2));

  await browser.close();
}

testSmartApply().catch(console.error);
