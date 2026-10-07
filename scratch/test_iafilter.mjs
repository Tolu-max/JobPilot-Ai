import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { parseMosaicJobCards } from '../src/scrapers/indeed.js';

async function testIaFilter() {
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
  console.log('Navigating to Indeed with iafilter=1...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&sort=date&iafilter=1', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(2500);

  const scriptText = await page.evaluate(() => {
    const el = document.getElementById('mosaic-data');
    return el ? el.textContent : '';
  });

  const cards = parseMosaicJobCards(scriptText);
  console.log(`Parsed ${cards.length} jobs with iafilter=1`);
  for (const card of cards.slice(0, 5)) {
    console.log(`- [${card.jobkey}] "${card.title}" at "${card.company}" | indeedApplyEnabled: ${card.indeedApplyEnabled}`);
  }

  await browser.close();
}

testIaFilter().catch(console.error);
