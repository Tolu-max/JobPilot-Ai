import { chromium } from 'playwright';
import path from 'node:path';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5569916');
  
  const resumePath = path.resolve('profiles/tolu/resumes/fullstack/resume.pdf');
  
  // Set files on #resume
  const resumeInput = page.locator('#resume');
  await resumeInput.setInputFiles(resumePath);
  await resumeInput.evaluate(el => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(3000);

  // Check what changed around resume
  const text = await page.locator('fieldset:has(#resume), div:has(#resume)').first().innerText().catch(() => '');
  console.log('Resume section text after setInputFiles:', text.replace(/\n+/g, ' '));

  await browser.close();
})();
