import { buildConfig } from '../src/config.js';
import { chromium } from 'playwright';
import myjobmagAdapter from '../src/adapters/myjobmag.js';
import { loadCvData } from '../src/cvParser.js';
import fs from 'node:fs';

const config = buildConfig(['--profile=tolu']);
const cvData = await loadCvData(config);
config.cvData = cvData;

console.log('--- Candidate Config ---');
console.log('Profile:', config.profileName);
console.log('Candidate Name:', cvData?.name);
console.log('Candidate Email:', cvData?.email);
console.log('Resume Path:', config.resumePath, 'Exists:', fs.existsSync(config.resumePath));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
});
const page = await context.newPage();

page.on('requestfailed', req => {
  console.log('[Net FAIL]', req.method(), req.url(), req.failure()?.errorText);
});

page.on('response', res => {
  if (res.url().includes('myjobmag') || res.status() >= 300) {
    console.log('[Net RESP]', res.status(), res.statusText(), res.url());
  }
});

// Catch browser dialogs
page.on('dialog', async (dialog) => {
  console.log(`[Browser Dialog] Type: ${dialog.type()}, Message: ${dialog.message()}`);
  await dialog.accept().catch(() => {});
});

const targetJobUrl = 'https://www.myjobmag.com/job-application/1326820';
console.log('\nNavigating to:', targetJobUrl);
await page.goto(targetJobUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

const step = await myjobmagAdapter.getCurrentStep(page);
console.log('Detected Step:', step);

const tailoredCoverLetter = `Dear Hiring Team,

I am writing to express my strong interest in the Full Stack Developer / Software Engineer position at Bema Integrated Services. With robust experience building web applications using Laravel, PHP, JavaScript, React, and MySQL, alongside hands-on experience developing fintech solutions and responsive customer portals, I am confident in my ability to deliver immediate value to your team.

Thank you for your consideration. I look forward to the opportunity to discuss how my skills align with your goals.

Warm regards,
Toluwalope Samuel Oyelola
${cvData?.email || 'toluoyelola066@gmail.com'}
${cvData?.phone || '08083723613'}`;

const ctx = {
  config: { ...config, testMode: false, noRealSubmission: false },
  candidate: cvData,
  coverLetter: tailoredCoverLetter,
  resumePath: config.resumePath
};

console.log('\nFilling form...');
const fillResult = await myjobmagAdapter.fillStep(page, step, ctx);
console.log('Fill result:', fillResult);

// Check values before submit
const nameVal = await page.locator('input[name="sender_name"]').inputValue().catch(() => '');
const emailVal = await page.locator('input[name="sender_email"]').inputValue().catch(() => '');
const phoneVal = await page.locator('input[name="sender_phone"]').inputValue().catch(() => '');
const relocVal = await page.locator('select[name="sender_relocation"]').inputValue().catch(() => '');
const fileVal = await page.locator('input[name="cv"]').inputValue().catch(() => '');
console.log(`Pre-submit values: Name="${nameVal}", Email="${emailVal}", Phone="${phoneVal}", Relocation="${relocVal}", File="${fileVal}"`);

// Take pre-submit screenshot
fs.mkdirSync('artifacts', { recursive: true });
await page.screenshot({ path: 'artifacts/myjobmag-live-before-submit.png', fullPage: true });
console.log('Pre-submit screenshot saved to artifacts/myjobmag-live-before-submit.png');

console.log('\nSubmitting application for real (testMode: false)...');
const advanceResult = await myjobmagAdapter.advance(page, step, ctx);
console.log('Advance result:', advanceResult);

await page.waitForTimeout(6000);

const finalUrl = page.url();
const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('\n--- POST-SUBMISSION STATUS ---');
console.log('Final URL:', finalUrl);

// Check for submission indicators or error indicators
const isSuccess = await myjobmagAdapter.isSubmitted(page, ctx);
console.log('isSubmitted check:', isSuccess);

const verification = await myjobmagAdapter.verifySubmission(page, ctx);
console.log('verifySubmission check:', verification);

// Look for any alert or message on page
const alertMessages = await page.locator('.alert, .msg, .message, .notification, .success, .error, #flash-msg, .app-response').allInnerTexts().catch(() => []);
if (alertMessages.length > 0) {
  console.log('Alert/Message boxes found:', alertMessages);
}

// Take post-submit screenshot
await page.screenshot({ path: 'artifacts/myjobmag-live-after-submit.png', fullPage: true });
console.log('Post-submit screenshot saved to artifacts/myjobmag-live-after-submit.png');

// First 300 chars of body text preview
const cleanBody = bodyText.replace(/\s+/g, ' ').trim().slice(0, 300);
console.log('Page body snippet:', cleanBody);

await browser.close();
console.log('\nLive apply test execution finished.');
