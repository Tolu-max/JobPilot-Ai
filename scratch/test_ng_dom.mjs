import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testDom() {
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
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(2500);

  const pageResults = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk]'));
    return cards.map((c) => {
      const titleLink = c.querySelector('h2.jobTitle a, a[data-jk], [data-testid="job-title-link"]');
      const comp = c.querySelector('[data-testid="company-name"], .companyName');
      const loc = c.querySelector('[data-testid="text-location"], .companyLocation');
      const jk = c.getAttribute('data-jk') || titleLink?.getAttribute('data-jk');
      return {
        jobkey: jk,
        title: titleLink?.innerText?.trim() || '',
        company: comp?.innerText?.trim() || '',
        location: loc?.innerText?.trim() || '',
        href: titleLink?.getAttribute('href') || ''
      };
    }).filter((j) => j.title && j.jobkey);
  });

  console.log(`DOM found ${pageResults.length} jobs.`);
  console.log(JSON.stringify(pageResults.slice(0, 3), null, 2));

  await browser.close();
}

testDom().catch(console.error);
