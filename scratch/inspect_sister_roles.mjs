import { chromium } from 'playwright';

async function checkHimalayasRoles() {
  const browser = await chromium.launch({ headless: true });
  const urls = [
    { title: 'Magic CRE Admin', url: 'https://himalayas.app/companies/getmagic/jobs/commercial-real-estate-operations-admin-freelance-remote-1910435204' },
    { title: 'Sedgwick Admin Assistant', url: 'https://himalayas.app/companies/sedgwick/jobs/administrative-assistant-296207994' },
    { title: 'LTVplus Support Agent', url: 'https://himalayas.app/companies/ltvplus/jobs/part-time-customer-service-agent-for-a-consumer-goods-e-commerce-company-talent' },
    { title: 'BruntWork Aus Support', url: 'https://bruntworkcareers.co/jobs/61820009815' }
  ];

  for (const item of urls) {
    console.log(`\nInspecting ${item.title} (${item.url})...`);
    const page = await browser.newPage();
    try {
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1500);

      // Look for Apply buttons or external links
      const applyLinks = await page.locator('a[href*="apply"], a:has-text("Apply"), a[href*="greenhouse"], a[href*="ashby"], a[href*="lever"], a[href*="workable"], a[href*="bamboohr"]').all();
      console.log(`Found ${applyLinks.length} apply links`);
      for (const l of applyLinks.slice(0, 3)) {
        const text = await l.innerText().catch(() => '');
        const href = await l.getAttribute('href').catch(() => '');
        console.log(`  [Link] "${text}" -> ${href}`);
      }

      // Check if this is a direct form (e.g. BruntWork)
      const formInputs = await page.locator('input[type="file"], input[name*="name" i], input[name*="email" i]').count();
      console.log(`  Direct form inputs: ${formInputs}`);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
}

checkHimalayasRoles().catch(console.error);
