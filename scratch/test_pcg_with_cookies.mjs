import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';

async function testWithCookies() {
  const cookies = await loadIndeedCookies('tolu');
  console.log('Loaded cookies count:', cookies?.length);

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
  console.log('Navigating with cookies...');
  await page.goto('https://www.indeed.com/viewjob?jk=6383d80d654c902b', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(4000);

  console.log('Title:', await page.title());
  console.log('URL:', page.url());

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a')).map(b => ({
      tag: b.tagName,
      text: b.innerText?.trim(),
      href: b.getAttribute('href'),
      testId: b.getAttribute('data-testid')
    })).filter(b => /apply/i.test(b.text || b.testId || b.href || ''));
  });
  console.log('Apply buttons:', JSON.stringify(buttons, null, 2));

  await browser.close();
}

testWithCookies().catch(console.error);
