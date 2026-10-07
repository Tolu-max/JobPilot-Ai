import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Test Greenhouse live URL:
  console.log('--- Testing Greenhouse ---');
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5569916');
  console.log('Greenhouse title:', await page.title());
  const ghInputs = await page.$$eval('input', els => els.map(e => e.id || e.name || e.type));
  console.log('Greenhouse inputs:', ghInputs.slice(0, 10));

  // Test Ashby board:
  console.log('--- Testing Ashby ---');
  await page.goto('https://jobs.ashbyhq.com/posthog', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log('PostHog title:', await page.title());
  const links = await page.$$eval('a[href]', els => els.map(e => e.href).filter(h => !h.includes('privacy') && !h.includes('security')));
  console.log('PostHog links:', links.slice(0, 5));
  if (links.length > 0) {
    console.log('Navigating to link 0:', links[0]);
    await page.goto(links[0], { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    console.log('Job page title:', await page.title());
    const inputs = await page.$$eval('input, textarea', els => els.map(e => e.name || e.id || e.type));
    console.log('Ashby inputs:', inputs);
  }

  await browser.close();
})();
