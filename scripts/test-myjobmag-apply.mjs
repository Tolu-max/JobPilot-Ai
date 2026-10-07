import { buildConfig } from '../src/config.js';
import { chromium } from 'playwright';
import myjobmagAdapter from '../src/adapters/myjobmag.js';
import fs from 'node:fs';

const config = buildConfig(['--profile=tolu']);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const testUrl = 'https://www.myjobmag.com/job-application/1326820';
console.log('Navigating to:', testUrl);
await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

const step = await myjobmagAdapter.getCurrentStep(page);
console.log('Current step detected:', step);

const ctx = {
  config: { ...config, testMode: true },
  candidate: {
    name: 'Toluwalope Samuel Oyelola',
    email: 'toluoyelola066@gmail.com',
    phone: '(+234) 07062187105',
    city: 'Lagos',
    yearsOfExperience: 4,
    summary: 'Experienced Full Stack Developer with 4+ years building high-performance web applications.'
  },
  coverLetter: 'Dear Hiring Team,\n\nI am excited to apply for the Full Stack Developer role at Bema Integrated Services. With extensive experience in React, JavaScript, Node.js, and modern web architectures, I can immediately contribute to your product team.\n\nBest regards,\nToluwalope Oyelola',
  resumePath: config.resumePath
};

console.log('Resume exists?', fs.existsSync(config.resumePath), config.resumePath);

console.log('Filling form with candidate data...');
const fillResult = await myjobmagAdapter.fillStep(page, step, ctx);
console.log('Fill result:', fillResult);

// Verify field values
const nameVal = await page.locator('input[name="sender_name"]').inputValue();
const emailVal = await page.locator('input[name="sender_email"]').inputValue();
const phoneVal = await page.locator('input[name="sender_phone"]').inputValue();
const expVal = await page.locator('select[name="sender_experience"]').inputValue();
const locVal = await page.locator('select[name="sender_location"]').inputValue();
const coverVal = await page.locator('textarea[name="apply_body"]').inputValue();
const fileVal = await page.locator('input[name="cv"]').inputValue();

console.log('--- VERIFICATION ---');
console.log('Name filled:', nameVal);
console.log('Email filled:', emailVal);
console.log('Phone filled:', phoneVal);
console.log('Experience selected:', expVal);
console.log('Location selected:', locVal);
console.log('Cover letter length:', coverVal.length, 'chars');
console.log('CV attached:', fileVal ? `YES (${fileVal})` : 'NO');

// Check captcha
const captchaVisible = await page.locator('.g-recaptcha, iframe[src*="recaptcha"]').isVisible().catch(() => false);
console.log('reCAPTCHA detected on form:', captchaVisible);

// Advance in test mode
const advResult = await myjobmagAdapter.advance(page, step, ctx);
console.log('Advance result (test mode):', advResult);

// Save screenshot
fs.mkdirSync('artifacts', { recursive: true });
await page.screenshot({ path: 'artifacts/myjobmag-test-application.png', fullPage: true });
console.log('Screenshot saved to artifacts/myjobmag-test-application.png');

await browser.close();
console.log('Test completed successfully!');
