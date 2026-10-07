import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import { getAdapter } from '../src/adapters/index.js';
import { buildConfig } from '../src/config.js';

async function test() {
  const config = buildConfig(['node', 'test', '--profile=tolu']);
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
  await page.goto('https://www.indeed.com/jobs?q=technical+seo&l=Remote&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log('Page title:', title);

  const jobLinks = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk]'));
    return cards.map(c => {
      const a = c.querySelector('h2.jobTitle a, a[data-jk], [data-testid="job-title-link"]');
      const jk = c.getAttribute('data-jk') || a?.getAttribute('data-jk');
      return { jk, title: a?.innerText?.trim(), href: a?.getAttribute('href') };
    }).filter(j => j.jk);
  });

  console.log(`Found ${jobLinks.length} job cards.`);
  if (jobLinks.length > 0) {
    const first = jobLinks[0];
    const jobUrl = first.href?.startsWith('http') ? first.href : `https://www.indeed.com/viewjob?jk=${first.jk}`;
    console.log(`Testing job: "${first.title}" -> ${jobUrl}`);

    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);
    console.log('Job page title:', await page.title());
    console.log('Job page URL:', page.url());

    const adapter = getAdapter(jobUrl);
    console.log('Adapter matched:', adapter.name);

    const step = await adapter.getCurrentStep(page, { config });
    console.log('Current step:', step);

    const advanceResult = await adapter.advance(page, step, { config });
    console.log('Advance result:', JSON.stringify(advanceResult, null, 2));
  }

  await browser.close();
}

test().catch(console.error);
