import { chromium } from 'playwright';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../src/stealthInit.js';
import { buildConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

const url = 'https://erbis.breezy.hr/p/b816a79ed6ed01-wordpress-developer-freelance/apply';
const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
const resumePath = '/app/profiles/tolu/resumes/wordpress-seo/resume.pdf';

const browser = await chromium.launch({
  headless: true,
  args: [...stealthArgs, '--disable-gpu']
});

const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  userAgent: stealthUserAgent
});
await context.addInitScript(getStealthScript());
const page = await context.newPage();

console.log('Navigating to:', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

// 1. Upload resume
if (fs.existsSync(resumePath)) {
  console.log('Uploading resume:', resumePath);
  const fileInput = page.locator('input[name="cResume"], input[type="file"]').first();
  await fileInput.setInputFiles(resumePath);
  await page.waitForTimeout(5000);
}

// 2. Fill personal details
console.log('Filling personal details...');
await page.locator('input[name="cName"]').fill('TOLUWALOPE SAMUEL OYELOLA');
await page.locator('input[name="cEmail"]').fill('toluoyelola066@gmail.com');

const phone = page.locator('input[name="cPhoneNumber"]');
if (await phone.isVisible().catch(() => false)) {
  await phone.fill('+2347062187105');
}

// Desired salary
const salary = page.locator('input[name="cSalary"]');
if (await salary.isVisible().catch(() => false)) {
  await salary.fill('25'); // $25/hr
}

// Period
const periodSelect = page.locator('select[ng-model="candidate.salary.period"]');
if (await periodSelect.isVisible().catch(() => false)) {
  await periodSelect.selectOption({ label: 'Hourly' }).catch(() => periodSelect.selectOption({ index: 5 }));
}

// Take screenshot of step 1
await page.screenshot({ path: '/app/debug/breezy-step1.png', fullPage: true });

// Check for continue or next button
let continueBtn = page.locator('button[ng-click="nextSection()"]:visible, button:has-text("Continue"):visible').first();
if (await continueBtn.isVisible().catch(() => false)) {
  console.log('Clicking Continue from step 1...');
  await continueBtn.click({ force: true });
  await page.waitForTimeout(3000);
}

// Step 2 / Questionnaire
console.log('Checking for questionnaire inputs...');
const rateInput = page.locator('input[name*="question"]:visible, textarea[name*="question"]:visible');
const count = await rateInput.count().catch(() => 0);
console.log('Question inputs found:', count);
for (let i = 0; i < count; i++) {
  const input = rateInput.nth(i);
  await input.fill('25'); // $25/hr
}

await page.screenshot({ path: '/app/debug/breezy-step2.png', fullPage: true });

continueBtn = page.locator('button[ng-click="nextSection()"]:visible, button:has-text("Continue"):visible').first();
if (await continueBtn.isVisible().catch(() => false)) {
  console.log('Clicking Continue from step 2...');
  await continueBtn.click({ force: true });
  await page.waitForTimeout(3000);
}

// GDPR Checkbox
const gdpr = page.locator('input[name="gdprAgreement"], input[type="checkbox"]:visible');
const gdprCount = await gdpr.count().catch(() => 0);
console.log('GDPR checkboxes found:', gdprCount);
for (let i = 0; i < gdprCount; i++) {
  await gdpr.nth(i).check({ force: true }).catch(() => {});
}

await page.screenshot({ path: '/app/debug/breezy-step3.png', fullPage: true });

// Submit button
const submitBtn = page.locator('button[ng-click="apply()"]:visible, button:has-text("Submit Application"):visible').first();
if (await submitBtn.isVisible().catch(() => false)) {
  console.log('Clicking Submit Application...');
  await submitBtn.click({ force: true });
  await page.waitForTimeout(8000);
}

await page.screenshot({ path: '/app/debug/breezy-final.png', fullPage: true });
const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
const submitted = /thank you for applying|application submitted|your application has been submitted|your application has been received/i.test(body);

console.log('Submission result:', {
  submitted,
  bodySnippet: body.slice(0, 500).replace(/\s+/g, ' ')
});

await context.close();
await browser.close();
