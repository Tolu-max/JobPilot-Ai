import { chromium } from 'playwright';
import path from 'node:path';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5569916');
  await page.waitForTimeout(2000);
  const resumePath = path.resolve('profiles/tolu/resumes/fullstack/resume.pdf');
  const attachBtn = page.locator('button:has-text("Attach")').first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    attachBtn.click()
  ]);
  await fileChooser.setFiles(resumePath);
  await page.waitForTimeout(2000);
  const text = await page.locator('.field:has(#resume), [data-field="resume"], div:has(> #resume)').first().innerText().catch(() => '');
  console.log('Resume field text:', text);
  await browser.close();
})();
