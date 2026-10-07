import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';

async function testPane() {
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
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date&vjk=8e08cdf56c4b7a59', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3500);

  const paneInfo = await page.evaluate(() => {
    const pane = document.querySelector('#jobsearch-ViewjobPaneWrapper, .jobsearch-ViewJobLayout, .fastviewjob');
    const allLinks = Array.from(document.querySelectorAll('a, button')).map(el => ({
      text: el.innerText?.trim(),
      href: el.getAttribute('href'),
      id: el.id,
      className: el.className
    })).filter(x => /apply|submit/i.test(x.text || '') || /apply/i.test(x.id || '') || /apply/i.test(x.href || ''));
    return {
      hasPane: Boolean(pane),
      applyLinks: allLinks
    };
  });

  console.log('Pane info:', JSON.stringify(paneInfo, null, 2));

  await browser.close();
}

testPane().catch(console.error);
