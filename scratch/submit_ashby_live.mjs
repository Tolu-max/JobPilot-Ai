import playwright from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ashbyAdapter from '../src/adapters/ashby.js';
import { FormStep } from '../src/adapters/types.js';
import { buildConfig } from '../src/config.js';

async function main() {
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  config.testMode = false;
  config.noRealSubmission = false;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to OpenRouter Ashby application...');
  await page.goto('https://jobs.ashbyhq.com/openrouter/7088bf7a-6ed7-4c35-bd61-6303e712205c/application', {
    waitUntil: 'networkidle',
    timeout: 45000
  });
  await page.waitForTimeout(3000);

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

  console.log('Filling form...');
  await ashbyAdapter.fillStep(page, FormStep.DETAILS, ctx);
  await page.waitForTimeout(2000);

  const { auditRequiredFields } = await import('../src/adapters/atsFormHelpers.js');
  const audit = await auditRequiredFields(page);
  console.log('Audit result:', JSON.stringify(audit, null, 2));

  console.log('Submitting application...');
  const advanceResult = await ashbyAdapter.advance(page, FormStep.DETAILS, ctx);
  console.log('Advance result:', advanceResult);

  const confirmationScreenshot = path.resolve('artifacts/openrouter-application-submitted.png');
  await page.screenshot({ path: confirmationScreenshot, fullPage: true });
  console.log('Confirmation screenshot saved to:', confirmationScreenshot);

  const confirmationCheck = await ashbyAdapter.isSubmitted(page);
  console.log('Confirmation check:', confirmationCheck);

  await browser.close();
}

main().catch(console.error);
