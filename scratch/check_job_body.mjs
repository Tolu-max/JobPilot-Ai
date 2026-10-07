import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { parseMosaicJobCards } from '../src/scrapers/indeed.js';

async function checkJobView() {
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
  console.log('Navigating to Indeed US remote SEO...');
  await page.goto('https://www.indeed.com/jobs?q=technical+seo&l=Remote&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const scriptText = await page.evaluate(() => {
    const el = document.getElementById('mosaic-data');
    return el ? el.textContent : '';
  });
  const cards = parseMosaicJobCards(scriptText);
  console.log(`Found ${cards.length} cards from mosaic-data.`);

  const pcg = cards.find(c => (c.company || c.truncatedCompany || '').toLowerCase().includes('pcg')) || cards[0];
  if (pcg) {
    console.log('Testing job:', pcg.title, 'at', pcg.company || pcg.truncatedCompany);
    console.log('Link in card:', pcg.link);
    console.log('viewJobLink:', pcg.viewJobLink);
    console.log('thirdPartyApplyUrl:', pcg.thirdPartyApplyUrl);
    console.log('indeedApplyEnabled:', pcg.indeedApplyEnabled);

    const jobUrl = pcg.link ? (pcg.link.startsWith('http') ? pcg.link : `https://www.indeed.com${pcg.link}`) : `https://www.indeed.com/viewjob?jk=${pcg.jobkey}`;
    console.log('Navigating to jobUrl:', jobUrl);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000);

    console.log('Current URL after goto:', page.url());
    console.log('Page title:', await page.title());
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    console.log('Body length:', body.length);
    console.log('First 300 chars of body:', body.substring(0, 300).replace(/\n/g, ' '));
  }

  await browser.close();
}

checkJobView().catch(console.error);
