import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadIndeedCookies } from '../src/scrapers/indeed.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../src/stealthInit.js';
import { loadJobStore, upsertJobRecord } from '../src/jobStore.js';
import { buildConfig } from '../src/config.js';

async function applyCorvendra() {
  const config = buildConfig([process.argv[0], 'jobpilot', '--profile=tolu']);
  const debugDir = path.join('debug', 'corvendra_application');
  await fs.mkdir(debugDir, { recursive: true });

  console.log('[1/6] Launching Playwright stealth browser...');
  const browser = await chromium.launch({
    headless: true,
    args: stealthArgs.filter((arg) => arg !== '--no-startup-window' && arg !== '--silent')
  });

  const context = await browser.newContext({
    userAgent: stealthUserAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  await context.addInitScript(getStealthScript());

  const cookies = await loadIndeedCookies('tolu', config);
  if (cookies?.length) {
    await context.addCookies(cookies);
    console.log(`[1/6] Loaded ${cookies.length} session cookies for Tolu.`);
  }

  const page = await context.newPage();

  console.log('[2/6] Navigating to Abuja developer jobs on Indeed Nigeria...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja', {
    waitUntil: 'domcontentloaded',
    timeout: 35000
  });
  await page.waitForTimeout(2500);

  const targetJk = '106dd21672c04e6e';
  console.log(`[3/6] Locating job card for Corvendra Limited (${targetJk})...`);
  const card = await page.$(`[data-jk="${targetJk}"]`);
  if (!card) {
    throw new Error(`Job card ${targetJk} not found on Indeed Abuja page.`);
  }

  await card.evaluate((el) => el.click());
  await page.waitForTimeout(3000);

  console.log('[4/6] Finding Apply button in job pane...');
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 12000 }).catch(() => null),
    page.evaluate(() => {
      const btn = document.querySelector('[data-testid="viewjob-indeed-apply"], [data-testid="indeedApplyButton"], #indeedApplyButton');
      if (btn) btn.click();
    })
  ]);

  const applyPage = popup || page;
  console.log(`[4/6] Apply flow opened at URL: ${applyPage.url()}`);

  // Step 1: Wait for Contact Info form to finish loading
  console.log('[5/6] Waiting for Contact Info form to render...');
  for (let i = 0; i < 20; i++) {
    await applyPage.waitForTimeout(1000);
    const ready = await applyPage.evaluate(() => {
      const inputs = document.querySelectorAll('input:not([type="hidden"])');
      const spin = document.querySelector('.css-1baulp5, [role="progressbar"], svg[class*="spin"]');
      return inputs.length > 0 && !spin;
    });
    if (ready) break;
  }

  await applyPage.screenshot({ path: path.join(debugDir, '01_contact_info.png'), fullPage: true });
  console.log('[5/6] Saved screenshot: 01_contact_info.png');

  // Verify contact info fields are present
  const step1State = await applyPage.evaluate(() => {
    const fName = document.querySelector('input[name="names-first-name"]')?.value || '';
    const lName = document.querySelector('input[name="names-last-name"]')?.value || '';
    const phone = document.querySelector('input[name="phone"]')?.value || '';
    return { fName, lName, phone };
  });
  console.log(`[5/6] Contact Info Verified: ${step1State.fName} ${step1State.lName} | Phone: ${step1State.phone}`);

  // Advance Step 1 -> Step 2 (Location)
  console.log('Advancing from Contact to Location...');
  await applyPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /continue/i.test(b.innerText.trim()));
    if (btn) btn.click();
  });
  await applyPage.waitForTimeout(4000);

  // Advance Step 2 -> Step 3 (Resume Module)
  console.log('Advancing from Location to Resume module...');
  await applyPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /continue/i.test(b.innerText.trim()));
    if (btn) btn.click();
  });
  await applyPage.waitForTimeout(4000);

  // Step 3: Attach Tolu's dedicated Full Stack Resume PDF
  const resumePath = path.resolve('profiles/tolu/resumes/fullstack/resume.pdf');
  console.log('Attaching resume:', resumePath);
  await applyPage.setInputFiles('input[type="file"]', resumePath);
  await applyPage.waitForTimeout(4000);
  await applyPage.screenshot({ path: path.join(debugDir, '02_resume_uploaded.png'), fullPage: true });

  // Advance Step 3 -> Next Step
  console.log('Advancing from Resume module...');
  await applyPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /continue/i.test(b.innerText.trim()));
    if (btn) btn.click();
  });
  await applyPage.waitForTimeout(4000);

  // Continue wizard steps until review and final submit
  let stepIndex = 4;
  let finalSubmitted = false;
  let confirmationText = '';

  while (stepIndex <= 10) {
    stepIndex += 1;
    const url = applyPage.url();
    const heading = (await applyPage.locator('h1, h2, legend').allInnerTexts().catch(() => [])).join(' | ');
    console.log(`\n--- Wizard Step ${stepIndex} [${url}] ---`);
    console.log(`Heading: ${heading}`);

    await applyPage.screenshot({ path: path.join(debugDir, `step_${stepIndex}_before_click.png`), fullPage: true });

    // Handle any questions / inputs if present
    const hasQuestions = await applyPage.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="number"], textarea');
      return inputs.length > 0;
    });

    if (hasQuestions) {
      console.log('Detected questions/inputs on this step; filling standard developer responses...');
      await applyPage.evaluate(() => {
        const textInputs = document.querySelectorAll('input[type="number"], input[type="text"]');
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
      await applyPage.waitForTimeout(1000);
    }

    // Click the visible submit / review / continue button
    const clickResult = await applyPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const style = window.getComputedStyle(b);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && b.offsetWidth > 0;
      });

      // 1. Submit
      const submit = buttons.find((b) => /submit\s+(?:your\s+)?application|submit/i.test(b.innerText.trim()));
      if (submit) {
        submit.click();
        return { clicked: true, action: 'submit', text: submit.innerText.trim() };
      }

      // 2. Review
      const review = buttons.find((b) => /review\s+(?:your\s+)?application|review/i.test(b.innerText.trim()));
      if (review) {
        review.click();
        return { clicked: true, action: 'review', text: review.innerText.trim() };
      }

      // 3. Continue
      const cont = buttons.find((b) => /continue|next/i.test(b.innerText.trim()));
      if (cont) {
        cont.click();
        return { clicked: true, action: 'continue', text: cont.innerText.trim() };
      }

      return { clicked: false, availableButtons: buttons.map((b) => b.innerText.trim()) };
    });

    console.log(`Action:`, clickResult);

    if (!clickResult.clicked) {
      console.log('No action button found; checking for confirmation text...');
      break;
    }

    await applyPage.waitForTimeout(5000);

    // Check if submitted
    const isConfirmed = await applyPage.evaluate(() => {
      const text = document.body.innerText || '';
      return (
        /your\s+application\s+(?:has\s+been|was)\s+submitted|application\s+submitted|successfully\s+applied|you\s+have\s+applied/i.test(text)
      );
    });

    if (isConfirmed || clickResult.action === 'submit') {
      await applyPage.waitForTimeout(4000);
      const fullText = await applyPage.evaluate(() => document.body.innerText || '');
      if (/application\s+(?:has\s+been\s+)?submitted|successfully\s+applied|application\s+received|applied/i.test(fullText)) {
        finalSubmitted = true;
        confirmationText = 'Application submitted successfully to Corvendra Limited';
        await applyPage.screenshot({ path: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'), fullPage: true });
        console.log('\n=============================================');
        console.log('>>> APPLICATION SUCCESSFULLY SUBMITTED! <<<');
        console.log('=============================================\n');
        break;
      }
    }
  }

  // Final check if confirmed
  if (!finalSubmitted) {
    const postCheck = await applyPage.evaluate(() => {
      const text = document.body.innerText || '';
      return /application\s+(?:has\s+been\s+)?submitted|successfully\s+applied|application\s+received/i.test(text);
    });
    if (postCheck) {
      finalSubmitted = true;
      confirmationText = 'Application submitted successfully to Corvendra Limited';
      await applyPage.screenshot({ path: path.join(debugDir, '00_CONFIRMED_SUBMISSION.png'), fullPage: true });
    }
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
    console.log('[6/6] Job status updated to APPLIED in profiles/tolu/processedJobs.json');
  } else {
    await upsertJobRecord(config, corvendraJob, 'manual_review', {
      score: 85,
      decision: 'apply',
      reason: 'Application advanced to final review; check screenshot proof.',
      lastScreenshot: path.join(debugDir, `step_${stepIndex}_before_click.png`)
    });
    console.log('[6/6] Job recorded with latest step artifacts in profiles/tolu/processedJobs.json');
  }

  await browser.close();
  return { finalSubmitted, debugDir, confirmationText };
}

applyCorvendra().then((res) => console.log('Execution Summary:', res)).catch(console.error);
