import { chromium } from 'playwright';
import path from 'node:path';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5569916');
  await page.waitForTimeout(2000);

  const resumePath = path.resolve('profiles/tolu/resumes/fullstack/resume.pdf');

  console.log('Trying filechooser with Attach button...');
  const attachBtn = page.locator('button:has-text("Attach"), [data-source="attach"]').first();
  
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    attachBtn.click()
  ]);

  if (fileChooser) {
    console.log('FileChooser triggered!');
    await fileChooser.setFiles(resumePath);
    await page.waitForTimeout(3000);
    
    // Check if filename is displayed or error disappeared
    const text = await page.locator('fieldset:has(#resume), div:has(#resume)').first().innerText().catch(() => '');
    console.log('Resume section after fileChooser:', text.replace(/\n+/g, ' '));
  } else {
    console.log('No fileChooser triggered');
  }

  await browser.close();
})();
