import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';

async function testSmartUrl2() {
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
  await page.waitForTimeout(4000);

  console.log('SmartApply URL:', page.url());
  console.log('SmartApply title:', await page.title());

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).map(b => b.innerText?.trim()).filter(Boolean);
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(i => i.name || i.id || i.type);
    const heading = document.querySelector('h1, h2')?.innerText?.trim();
    return { heading, btns, inputs };
  });
  console.log('Rendered info:', JSON.stringify(info, null, 2));

  await browser.close();
}

testSmartUrl2().catch(console.error);
