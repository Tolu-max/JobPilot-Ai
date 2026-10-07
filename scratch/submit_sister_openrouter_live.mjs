import playwright from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import ashbyAdapter from '../src/adapters/ashby.js';
import { FormStep } from '../src/adapters/types.js';
import { buildConfig } from '../src/config.js';
import { auditRequiredFields } from '../src/adapters/atsFormHelpers.js';
import { upsertJobRecord } from '../src/jobStore.js';

async function main() {
  console.log('=== SUBMITTING SISTER LIVE APPLICATION TO OPENROUTER ===');
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  config.testMode = false;
  config.noRealSubmission = false;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = 'https://jobs.ashbyhq.com/openrouter/89ff6b47-ba08-4418-b24b-c136dbf2ef82/application';
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  const cvData = JSON.parse(fs.readFileSync('profiles/sister/cv-data.json', 'utf8'));
  const resumePath = path.resolve('profiles/sister/resume.pdf');

  const ctx = {
    config,
    candidate: cvData,
    resumePath,
    selectedResumeProfile: 'sister-support',
    coverLetter: '',
    answers: {},
    job: {
      title: 'Scaled Support Specialist',
      company: 'OpenRouter',
      applicationUrl: url
    },
    debugDir: 'artifacts'
  };

  console.log('Filling form with candidate data...');
  await ashbyAdapter.fillStep(page, FormStep.DETAILS, ctx);
  await page.waitForTimeout(2000);

  const preFilledScreenshot = path.resolve('artifacts/sister-openrouter-pre-submit.png');
  await page.screenshot({ path: preFilledScreenshot, fullPage: true });
  console.log('Pre-submit screenshot saved:', preFilledScreenshot);

  const audit = await auditRequiredFields(page);
  console.log('Audit result:', JSON.stringify(audit, null, 2));

  if (!audit.ok) {
    console.error('Audit failed:', audit.reason);
    await browser.close();
    process.exit(1);
  }

  console.log('Submitting application live...');
  const advanceResult = await ashbyAdapter.advance(page, FormStep.DETAILS, ctx);
  console.log('Advance result:', advanceResult);

  const confirmationScreenshot = path.resolve('artifacts/sister-openrouter-submitted.png');
  await page.screenshot({ path: confirmationScreenshot, fullPage: true });
  console.log('Final screenshot saved to:', confirmationScreenshot);

  const confirmationCheck = await ashbyAdapter.isSubmitted(page);
  console.log('Confirmation check:', confirmationCheck);

  if (confirmationCheck.submitted || advanceResult.advanced || advanceResult.step === FormStep.SUBMITTED) {
    console.log('Application submitted successfully! Recording in job store...');
    await upsertJobRecord(config, ctx.job, 'applied', {
      score: 85,
      decision: 'apply',
      acceptedViaCli: true,
      appliedAt: new Date().toISOString(),
      proofScreenshot: 'artifacts/sister-openrouter-submitted.png',
      confirmationText: confirmationCheck.reason || confirmationCheck.markers?.join(', ') || 'Application submitted successfully.'
    });
    console.log('Successfully recorded in Sister job store!');
  } else {
    console.log('Submission did not produce confirmation yet.');
  }

  await browser.close();
}

main().catch(console.error);
