import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { parseMosaicJobCards } from '../src/scrapers/indeed.js';

async function inspectMosaic() {
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
  console.log('Navigating to Indeed Nigeria...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(2500);

  const scriptText = await page.evaluate(() => {
    const el = document.getElementById('mosaic-data');
    return el ? el.textContent : '';
  });

  const cards = parseMosaicJobCards(scriptText);
  console.log(`Parsed ${cards.length} mosaic cards from ng.indeed.com`);
  if (cards.length > 0) {
    const sample = cards[0];
    console.log('Sample keys:', Object.keys(sample));
    console.log('Sample title:', sample.title);
    console.log('Sample jobkey:', sample.jobkey);
    console.log('Sample thirdPartyApplyUrl:', sample.thirdPartyApplyUrl);
    console.log('Sample link:', sample.link);
    console.log('Sample viewJobLink:', sample.viewJobLink);
    console.log('Sample indeedApplyEnabled:', sample.indeedApplyEnabled);
  }

  await browser.close();
}

inspectMosaic().catch(console.error);
