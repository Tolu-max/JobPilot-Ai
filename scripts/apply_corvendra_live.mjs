import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { buildConfig } from '../src/config.js';
import { upsertJobRecord } from '../src/jobStore.js';

async function runLiveApplication() {
  const config = buildConfig([process.argv[0], 'jobpilot', '--profile=tolu']);
  const debugDir = path.join('debug', 'corvendra_application');
  await fs.mkdir(debugDir, { recursive: true });

  console.log('[1/7] Connecting to Real Google Chrome via CDP (port 9333)...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const context = browser.contexts()[0] || await browser.newContext();

  const cookies = await loadIndeedCookies('tolu', config);
  const now = Date.now() / 1000;
  const validCookies = (cookies || []).filter(c => !c.expires || c.expires > now);
  console.log(`[1/7] Adding ${validCookies.length} valid session cookies...`);
  await context.addCookies(validCookies);

  const page = await context.newPage();
  console.log('[2/7] Navigating to Abuja developer jobs on Indeed Nigeria...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const targetJk = '106dd21672c04e6e';
  console.log(`[3/7] Clicking job card for Corvendra Limited (${targetJk})...`);
  const card = await page.$(`[data-jk="${targetJk}"]`);
  if (!card) {
    throw new Error(`Job card ${targetJk} not found on page.`);
  }

  await card.evaluate(el => el.click());
  await page.waitForTimeout(3500);

  const applyHref = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="viewjob-indeed-apply"], [data-testid="indeedApplyButton"], #indeedApplyButton');
    return btn ? btn.getAttribute('href') : null;
  });
  console.log(`[4/7] Apply URL extracted: ${applyHref}`);

  let applyPage = page;
  if (applyHref && applyHref.startsWith('http')) {
    applyPage = await context.newPage();
    console.log(`[4/7] Navigating to applyPage directly: ${applyHref.slice(0, 80)}...`);
    await applyPage.goto(applyHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
  } else {
    console.log(`[4/7] Clicking Apply button directly...`);
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
      page.evaluate(() => {
        const btn = document.querySelector('[data-testid="viewjob-indeed-apply"], [data-testid="indeedApplyButton"], #indeedApplyButton');
        if (btn) btn.click();
      })
    ]);
    if (popup) applyPage = popup;
  }

  await applyPage.waitForTimeout(4000);
  console.log(`[5/7] SmartApply page active at: ${applyPage.url()}`);

  // Helper to click visible primary action button
  async function advanceWizard(stepName) {
    console.log(`\n>>> Advancing: ${stepName} (URL: ${applyPage.url()}) <<<`);

    // Dismiss any "Something went wrong" modal if present
    const handledModal = await applyPage.evaluate(() => {
      const tryAgain = Array.from(document.querySelectorAll('button')).find(b => /try\s+again/i.test(b.innerText.trim()));
      if (tryAgain) {
        tryAgain.click();
        return 'try_again';
      }
      return null;
    });
    if (handledModal) {
      console.log(`Handled modal: ${handledModal}`);
      await applyPage.waitForTimeout(3000);
    }

    const actionResult = await applyPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const style = window.getComputedStyle(b);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && b.offsetWidth > 0;
      });

      // 1. Submit
      const submit = buttons.find((b) => /submit\s+(?:your\s+)?application|submit/i.test(b.innerText.trim()));
      if (submit) {
        submit.click();
        return { action: 'submit', text: submit.innerText.trim() };
      }

      // 2. Review
      const review = buttons.find((b) => /review\s+(?:your\s+)?application|review/i.test(b.innerText.trim()));
      if (review) {
        review.click();
        return { action: 'review', text: review.innerText.trim() };
      }

      // 3. Continue
      const cont = buttons.find((b) => /continue|next/i.test(b.innerText.trim()));
      if (cont) {
        cont.click();
        return { action: 'continue', text: cont.innerText.trim() };
      }

      return null;
    });

    console.log(`Action result for ${stepName}:`, actionResult);
    await applyPage.waitForTimeout(4000);
    return actionResult;
  }

  // Step 1: Contact Info
  console.log('[6/7] Processing Step 1: Contact Info...');
  for (let i = 0; i < 15; i++) {
    await applyPage.waitForTimeout(1000);
    const hasInputs = await applyPage.evaluate(() => document.querySelectorAll('input:not([type="hidden"])').length > 0);
    if (hasInputs) break;
  }
  await applyPage.screenshot({ path: path.join(debugDir, 'live_01_contact.png'), fullPage: true });
  await advanceWizard('Step 1 Contact Info');

  // Step 2: Location
  console.log('[6/7] Processing Step 2: Location...');
  await applyPage.screenshot({ path: path.join(debugDir, 'live_02_location.png'), fullPage: true });
  await advanceWizard('Step 2 Location');

  // Step 3: Resume
  console.log('[6/7] Processing Step 3: Resume...');
  await applyPage.screenshot({ path: path.join(debugDir, 'live_03_resume.png'), fullPage: true });
  
  // If resume is not yet uploaded, upload Tolu's resume PDF
  const resumeState = await applyPage.evaluate(() => {
    const text = document.body.innerText;
    const hasResume = /resume\.pdf|toluwalope/i.test(text);
    return { hasResume };
  });

  if (!resumeState.hasResume) {
    const fileInput = await applyPage.$('input[type="file"]');
    if (fileInput) {
      const resumePath = path.resolve('profiles/tolu/resumes/fullstack/resume.pdf');
      console.log('Uploading resume:', resumePath);
      await fileInput.setInputFiles(resumePath);
      await applyPage.waitForTimeout(5000);
    }
  } else {
    console.log('Tolu resume already uploaded and selected!');
  }

  await applyPage.screenshot({ path: path.join(debugDir, 'live_03_resume_selected.png'), fullPage: true });
  await advanceWizard('Step 3 Resume');

  // Loop through remaining steps
  let step = 4;
  let finalSubmitted = false;
  let confirmationText = '';

  while (step <= 10) {
    const currentUrl = applyPage.url();
    console.log(`\n[6/7] Processing Step ${step} | URL: ${currentUrl}`);
    const heading = (await applyPage.locator('h1, h2, legend').allInnerTexts().catch(() => [])).join(' | ');
    console.log(`Heading: ${heading}`);

    await applyPage.screenshot({ path: path.join(debugDir, `live_step_${step}.png`), fullPage: true });

    // Check if application is already confirmed submitted
    const isConfirmed = await applyPage.evaluate(() => {
      const text = document.body.innerText || '';
      return /your\s+application\s+(?:has\s+been|was)\s+submitted|application\s+submitted|successfully\s+applied|applied/i.test(text);
    });

    if (isConfirmed && !/save\s+job\s+and\s+exit/i.test(heading)) {
      finalSubmitted = true;
      confirmationText = 'Application submitted successfully to Corvendra Limited';
      await applyPage.screenshot({ path: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'), fullPage: true });
      console.log('\n=============================================');
      console.log('>>> CONFIRMED: APPLICATION SUCCESSFULLY SUBMITTED! <<<');
      console.log('=============================================\n');
      break;
    }

    // Auto-fill questions if any exist
    await applyPage.evaluate(() => {
      const textInputs = document.querySelectorAll('input[type="number"], input[type="text"], textarea');
      for (const input of textInputs) {
        if (!input.value) {
          const label = input.labels?.[0]?.innerText?.toLowerCase() || input.name?.toLowerCase() || '';
          if (label.includes('year') || label.includes('experience')) {
            input.value = '3';
          } else if (label.includes('salary') || label.includes('compensation')) {
            input.value = 'Negotiable';
          }
        }
      }
    });

    const result = await advanceWizard(`Step ${step}`);
    if (!result) {
      console.log('No further continue/submit button. Checking if confirmed...');
      await applyPage.waitForTimeout(3000);
      const postText = await applyPage.evaluate(() => document.body.innerText || '');
      if (/application\s+(?:has\s+been\s+)?submitted|successfully\s+applied/i.test(postText)) {
        finalSubmitted = true;
        confirmationText = 'Application submitted successfully to Corvendra Limited';
        await applyPage.screenshot({ path: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'), fullPage: true });
      }
      break;
    }

    if (result.action === 'submit') {
      console.log('Submit button clicked! Waiting 6s for confirmation page...');
      await applyPage.waitForTimeout(6000);
      const postText = await applyPage.evaluate(() => document.body.innerText || '');
      if (/application\s+(?:has\s+been\s+)?submitted|successfully\s+applied|applied/i.test(postText)) {
        finalSubmitted = true;
        confirmationText = 'Application submitted successfully to Corvendra Limited';
        await applyPage.screenshot({ path: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'), fullPage: true });
        console.log('\n=============================================');
        console.log('>>> CONFIRMED: APPLICATION SUCCESSFULLY SUBMITTED! <<<');
        console.log('=============================================\n');
      }
      break;
    }

    step++;
  }

  // Update processedJobs.json
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

  if (finalSubmitted) {
    await upsertJobRecord(config, corvendraJob, 'applied', {
      score: 85,
      decision: 'apply',
      appliedAt: new Date().toISOString(),
      acceptedViaUserPrompt: true,
      proofScreenshot: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'),
      confirmationText
    });
    console.log('[7/7] Job status updated to APPLIED in profiles/tolu/processedJobs.json');
  } else {
    await upsertJobRecord(config, corvendraJob, 'manual_review', {
      score: 85,
      decision: 'apply',
      reason: 'Application in progress; review latest screenshot proof.',
      lastScreenshot: path.join(debugDir, `live_step_${step}.png`)
    });
    console.log('[7/7] Recorded current step state in profiles/tolu/processedJobs.json');
  }

  console.log(`Execution finished. finalSubmitted: ${finalSubmitted}`);
  return { finalSubmitted, confirmationText };
}

runLiveApplication().catch(console.error);
