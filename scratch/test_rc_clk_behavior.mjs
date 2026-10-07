import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';

async function testRcClk() {
  const cookies = await loadIndeedCookies('tolu');
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
  if (cookies?.length) await context.addCookies(cookies);

  const page = await context.newPage();
  const clkUrl = 'https://www.indeed.com/rc/clk?jk=6383d80d654c902b';
  console.log('Navigating to rc/clk...');
  
  // Listen for navigations / requests
  page.on('response', res => {
    if (res.status() >= 300 && res.status() < 400) {
      console.log(`[Redirect] ${res.status()} -> ${res.headers()['location']}`);
    }
  });

  await page.goto(clkUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(e => console.log('Goto err:', e.message));
  await page.waitForTimeout(3000);

  console.log('Current URL after goto:', page.url());
  console.log('Title after goto:', await page.title());

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button')).map(el => ({
      tag: el.tagName,
      text: el.innerText?.trim(),
      href: el.getAttribute('href')
    })).filter(l => l.text && /apply|continue|visit|company/i.test(l.text));
  });
  console.log('Links on page:', JSON.stringify(links, null, 2));

  await browser.close();
}

testRcClk().catch(console.error);
