import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildConfig } from '../src/config.js';
import { upsertJobRecord } from '../src/jobStore.js';

async function submitFinalApplication() {
  const config = buildConfig([process.argv[0], 'jobpilot', '--profile=tolu']);
  const debugDir = path.join('debug', 'corvendra_application');
  await fs.mkdir(debugDir, { recursive: true });

  console.log('[1/4] Connecting to Real Google Chrome via CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const pages = browser.contexts()[0].pages();
  const applyPage = pages.find((p) => p.url().includes('smartapply.indeed.com'));

  if (!applyPage) {
    throw new Error('SmartApply tab not found in browser!');
  }

  console.log(`[2/4] Found SmartApply page: ${applyPage.url()}`);
  console.log('Heading:', await applyPage.locator('h1, h2').allInnerTexts().catch(() => []));

  // Find Submit your application button
  const submitBtn = applyPage.locator('button:has-text("Submit your application"), button:has-text("Submit")').first();
  const isVisible = await submitBtn.isVisible().catch(() => false);
  console.log('Submit button visible?', isVisible);

  if (!isVisible) {
    throw new Error('Submit your application button is not visible!');
  }

  console.log('[3/4] Clicking "Submit your application"...');
  await submitBtn.click();
  console.log('Clicked! Waiting for confirmation page...');

  // Wait for submission confirmation
  let isConfirmed = false;
  let confirmationText = '';

  for (let i = 0; i < 20; i++) {
    await applyPage.waitForTimeout(1000);
    const text = await applyPage.evaluate(() => document.body.innerText || '');
    if (
      /your application was submitted|your application has been submitted|application submitted|successfully applied|applied/i.test(
        text
      )
    ) {
      isConfirmed = true;
      confirmationText = 'Application submitted successfully to Corvendra Limited';
      console.log(`[3/4] Confirmation detected at second ${i + 1}!`);
      break;
    }
  }

  await applyPage.waitForTimeout(3000);
  const proofPath = path.join(debugDir, '00_CONFIRMED_SUBMISSION.png');
  await applyPage.screenshot({ path: proofPath, fullPage: true });
  console.log(`[4/4] Saved photographic proof: ${proofPath}`);

  const targetJk = '106dd21672c04e6e';
  const corvendraJob = {
    source: 'indeed',
    source_site: 'indeed',
    sourceJobId: targetJk,
    title: 'Full stack developer',
    company: 'Corvendra Limited',
    location: 'Abuja',
    applicationUrl: `https://ng.indeed.com/viewjob?jk=${targetJk}`,
    is_remote: false,
    score: 85,
    decision: 'apply'
  };

  if (isConfirmed) {
    await upsertJobRecord(config, corvendraJob, 'applied', {
      score: 85,
      decision: 'apply',
      appliedAt: new Date().toISOString(),
      acceptedViaUserPrompt: true,
      proofScreenshot: proofPath,
      confirmationText
    });
    console.log('\n======================================================');
    console.log('>>> APPLICATION SUCCESSFULLY APPLIED AND STORED! <<<');
    console.log('======================================================\n');
  } else {
    console.log('Warning: Confirmation text not explicitly matched in 20 seconds. Check proof screenshot.');
  }

  return { isConfirmed, proofPath, confirmationText };
}

submitFinalApplication().then(res => console.log('Final Result:', res)).catch(console.error);
