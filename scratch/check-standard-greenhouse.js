import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://boards.greenhouse.io/cloudflare/jobs/8097321');
  console.log('Title:', await page.title());
  const inputs = await page.$$eval('input', els => els.map(e => e.id || e.name));
  console.log('Inputs:', inputs.slice(0, 15));
  await browser.close();
})();
