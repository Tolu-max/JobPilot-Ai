import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { parseMosaicJobCards } from '../src/scrapers/indeed.js';

async function inspectFields() {
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
  await page.goto('https://ng.indeed.com/jobs?q=developer&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const scriptText = await page.evaluate(() => {
    const el = document.getElementById('mosaic-data');
    return el ? el.textContent : '';
  });

  const cards = parseMosaicJobCards(scriptText);
  console.log(`Parsed ${cards.length} cards.`);
  for (const card of cards) {
    if (!card.indeedApplyEnabled) {
      console.log('=== External Job ===');
      console.log('Title:', card.title);
      console.log('Company:', card.company);
      for (const [k, v] of Object.entries(card)) {
        if (typeof v === 'string' && (v.includes('http') || v.includes('www') || v.includes('.com') || v.includes('apply'))) {
          console.log(`  ${k}: ${v.slice(0, 120)}`);
        }
      }
      break;
    }
  }

  await browser.close();
}

inspectFields().catch(console.error);
