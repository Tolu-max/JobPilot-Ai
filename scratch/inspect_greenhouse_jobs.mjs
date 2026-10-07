import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  const urls = [
    { name: 'GitLab', url: 'https://job-boards.greenhouse.io/gitlab/jobs/8761409002' },
    { name: 'CodeAI', url: 'https://job-boards.greenhouse.io/codeorg/jobs/4727981005' },
    { name: 'Sprout Social', url: 'https://job-boards.greenhouse.io/sproutsocial/jobs/8152724' }
  ];

  for (const item of urls) {
    console.log(`\nChecking ${item.name} (${item.url})...`);
    const page = await browser.newPage();
    try {
      const resp = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(`Status: ${resp.status()}, Final URL: ${page.url()}`);
      const formExists = await page.locator('form#application_form, form[action*="greenhouse"], form').count();
      const body = await page.locator('body').innerText().catch(() => '');
      const isOpen = !/job is no longer available|position has been filled|page not found/i.test(body);
      console.log(`Open: ${isOpen}, Forms: ${formExists}`);
      const inputs = await page.locator('input:visible, select:visible, textarea:visible').count();
      console.log(`Visible inputs: ${inputs}`);
    } catch (e) {
      console.log(`Error checking ${item.name}: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
}

main().catch(console.error);
