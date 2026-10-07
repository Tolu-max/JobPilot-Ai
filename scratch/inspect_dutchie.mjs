import { chromium } from 'playwright';

async function inspectDutchie() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to jobicy Dutchie page...');
  await page.goto('https://jobicy.com/jobs/153186-product-support-specialist-2', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const applyLink = await page.locator('a:has-text("Apply"), a[href*="greenhouse"], a[href*="ashby"], a[href*="lever"], a[class*="apply"]').first();
  const href = await applyLink.getAttribute('href').catch(() => null);
  console.log('Direct apply link href:', href);

  // Look for any external apply button or link
  const links = await page.locator('a[href]').evaluateAll(els => els.map(e => ({ text: e.innerText.trim(), href: e.href })).filter(x => /apply|greenhouse|lever|ashby|job/i.test(x.text) || /greenhouse|lever|ashby/i.test(x.href)));
  console.log('Candidate links:', links);

  await browser.close();
}

inspectDutchie().catch(console.error);
