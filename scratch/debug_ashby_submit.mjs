import playwright from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import ashbyAdapter from '../src/adapters/ashby.js';
import { FormStep } from '../src/adapters/types.js';
import { buildConfig } from '../src/config.js';

async function main() {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  config.testMode = false;
  config.noRealSubmission = false;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]`, err.message));
  page.on('requestfailed', req => console.log(`[REQ FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`));
  page.on('response', res => {
    if (res.url().includes('ashby') && (res.status() >= 400 || res.url().includes('api') || res.url().includes('graphql') || res.url().includes('submit') || res.url().includes('candidate'))) {
      console.log(`[RESPONSE] ${res.status()} ${res.url()}`);
    }
  });

  await page.goto('https://jobs.ashbyhq.com/openrouter/7088bf7a-6ed7-4c35-bd61-6303e712205c/application', {
    waitUntil: 'networkidle',
    timeout: 45000
  });

  const cvData = JSON.parse(fs.readFileSync('profiles/tolu/cv-data.json', 'utf8'));
  const ctx = {
    config,
    candidate: cvData,
    resumePath: path.resolve('profiles/tolu/resumes/fullstack/resume.pdf'),
    selectedResumeProfile: 'tolu-fullstack',
    coverLetter: '',
    answers: {},
    job: {
      title: 'Enterprise Support Engineer (West Coast)',
      company: 'OpenRouter',
      applicationUrl: 'https://jobs.ashbyhq.com/openrouter/7088bf7a-6ed7-4c35-bd61-6303e712205c/application'
    },
    debugDir: 'artifacts'
  };

  console.log('Filling step...');
  await ashbyAdapter.fillStep(page, FormStep.DETAILS, ctx);
  await page.waitForTimeout(2000);

  const submitBtn = page.locator('button[type="submit"], button:has-text("Submit application"), button:has-text("Submit")').first();
  console.log('Submit button text:', await submitBtn.innerText());
  console.log('Submit button visible:', await submitBtn.isVisible());
  console.log('Submit button enabled:', await submitBtn.isEnabled());

  console.log('Clicking submit button with normal click...');
  await submitBtn.scrollIntoViewIfNeeded();
  await submitBtn.click();

  console.log('Waiting 10s to see network activity or DOM changes...');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const text = await submitBtn.innerText().catch(() => '');
    const url = page.url();
    console.log(`Sec ${i + 1}: URL=${url}, BtnText="${text}"`);
    const errorMessages = await page.locator('[class*="error"], [role="alert"]').allInnerTexts().catch(() => []);
    if (errorMessages.length > 0) {
      console.log(`Errors found at sec ${i + 1}:`, errorMessages);
    }
  }

  await browser.close();
}

main().catch(console.error);
