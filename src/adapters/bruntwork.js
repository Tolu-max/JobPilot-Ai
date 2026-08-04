// BruntWork apply-flow adapter.
//
// Flow (mapped by audit/recon-bruntwork-* on 2026-05-30):
//   Step 1 (EMAIL):   /jobs/{id}/apply
//                     - One input[type=email]
//                     - "Continue" button has type="submit" — DO NOT mistake for final submit
//                     - On click: POST /api/application returns 201, URL changes to /applications/{appId}
//
//   Step 2 (DETAILS): /applications/{appId}
//                     - Fields: First Name, Last Name, Preferred Name, Mobile Number, City,
//                       Country (select), Resume (file upload, PDF), 3+ textareas (Job Qualifications),
//                       Voice Recording link (text input), RAM dropdown, salary number fields
//                     - "Submit Application" button is DISABLED until the form passes client-side
//                       validation. Bot must fill every required field for it to enable.
//                     - On valid click: captcha may appear, then real submission fires.
//
// Re-verification (verifySubmission):
//   Open a fresh browser context (no cookies/local state), navigate to /jobs/{id}/apply,
//   enter the same email, click Continue. Observe:
//     - Fresh empty DETAILS form          → NOT_SUBMITTED (no record of prior app)
//     - DETAILS form with pre-filled data → NOT_SUBMITTED (BruntWork "continue your application")
//     - "Already applied" / success page  → CONFIRMED
//     - Anything else                     → INCONCLUSIVE

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { FormStep, Proof, noProof, proofFound } from './types.js';
import { request as aiRequest, TaskTypes } from '../aiRouter.js';
import {
  buildGroundedFallbackAnswer,
  cleanApplicationAnswer,
  validateApplicationAnswer
} from '../applicationAnswerGuard.js';

const NAME = 'bruntwork';
const SUCCESS_TEXT_PATTERN = /your application has been submitted|application (was )?successfully submitted|thank you for your application|we (have|'ve|ve) received your application|application is complete/i;

function matches(url) {
  if (!url) return false;
  return /bruntwork(careers)?\.co/i.test(url) || /apply\.bruntwork/i.test(url);
}

function isClosedJob(body) {
  return /no longer accepting applications?|position is closed|this job has been closed|application period has ended|not accepting.*applications?|job.*closed/i.test(String(body || ''));
}

// --- step detection ---------------------------------------------------------

async function getCurrentStep(page) {
  // Cheapest signal first: visible body text + url + visible inputs.
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');

  if (isClosedJob(body)) {
    throw new Error('Job is no longer accepting applications.');
  }

  // SUBMITTED first — if BruntWork rendered a success state we don't want to mistake it for a step.
  if (SUCCESS_TEXT_PATTERN.test(body)) {
    return FormStep.SUBMITTED;
  }
  if (/\/applications\/[^/]+\/(success|complete|thank)/i.test(url)) {
    return FormStep.SUBMITTED;
  }

  // CAPTCHA gate (when nothing else visible)
  const captchaVisible = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').first().isVisible({ timeout: 800 }).catch(() => false);
  const submitVisible = await page.getByRole('button', { name: /submit\s*application/i }).first().isVisible({ timeout: 800 }).catch(() => false);

  // EMAIL vs DETAILS:
  //  - EMAIL step: URL contains /apply and has a visible email input, no Submit Application button
  //  - DETAILS step: URL contains /applications/{id}, lots of inputs visible, Submit Application present (possibly disabled)
  const onApplyRoute = /\/jobs\/[^/]+\/apply/i.test(url);
  const onApplicationRoute = /\/applications\/[A-Za-z0-9-]+/i.test(url);

  const emailInputVisible = await page.locator('input[type="email"]').first().isVisible({ timeout: 800 }).catch(() => false);

  if (onApplyRoute && emailInputVisible && !submitVisible) {
    return FormStep.EMAIL;
  }

  // Count visible inputs (rough proxy) for DETAILS classification
  const visibleInputCount = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) n += 1;
    });
    return n;
  }).catch(() => 0);

  if (onApplicationRoute || submitVisible || visibleInputCount >= 4) {
    if (captchaVisible && !submitVisible) return FormStep.CAPTCHA;
    return FormStep.DETAILS;
  }

  // Error catch — if "error", "invalid" classes are visible and we're stuck on apply route
  const errorVisible = await page.locator('.error:visible, [class*="error" i]:visible, [aria-invalid="true"]:visible').first().isVisible({ timeout: 500 }).catch(() => false);
  if (errorVisible) return FormStep.ERROR;

  return FormStep.UNKNOWN;
}

// --- step filling -----------------------------------------------------------

async function fillStep(page, step, ctx) {
  if (step === FormStep.EMAIL) {
    await fillEmailStep(page, ctx);
    return;
  }
  if (step === FormStep.DETAILS) {
    await fillDetailsStep(page, ctx);
    return;
  }
  // No-op for other steps; advance/captcha handlers cover the rest
}

async function fillEmailStep(page, ctx) {
  const email = ctx.candidate?.email || ctx.config?.applicantEmail || '';
  if (!email) throw new Error('[bruntwork.fillEmailStep] no candidate email available');
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(email);
  await page.waitForTimeout(300);
}

async function fillDetailsStep(page, ctx) {
  const cv = ctx.candidate || {};
  const telemetry = getTelemetry(ctx);

  // safeFill: fill with synthetic input/change/blur events if field is currently empty or forced
  const safeFill = async (locator, value) => {
    if (!value) return false;
    try {
      const el = locator.first();
      if (await el.isVisible({ timeout: 1500 })) {
        const current = await el.inputValue().catch(() => '');
        if (current && current.trim().length > 0) return false; // already filled, skip
        await el.fill(value);
        await el.dispatchEvent('input', { bubbles: true }).catch(() => {});
        await el.dispatchEvent('change', { bubbles: true }).catch(() => {});
        await el.dispatchEvent('blur', { bubbles: true }).catch(() => {});
        await page.waitForTimeout(120);
        return true;
      }
    } catch { /* not present on this form */ }
    return false;
  };

  // 1. Fill personal details if missing or empty
  const fullName = cv.fullName || cv.name || `${cv.firstName || ''} ${cv.lastName || ''}`.trim();
  const firstName = cv.firstName || (fullName ? fullName.split(' ')[0] : '');
  const lastName = cv.lastName || (fullName ? fullName.split(' ').slice(-1)[0] : '');

  await safeFill(page.locator('input[name="firstName"], input[placeholder*="First Name" i]'), firstName);
  await safeFill(page.locator('input[name="lastName"], input[placeholder*="Last Name" i]'), lastName);
  await safeFill(page.locator('input[name="fullLegalName"], input[placeholder*="Full Legal Name" i]'), fullName || `${firstName} ${lastName}`.trim());
  await safeFill(page.locator('input[name="preferredName"], input[placeholder*="Preferred Name" i]'), firstName);
  await safeFill(page.locator('input[name="mobileNumber"], input[placeholder*="Mobile" i]'), cv.phone || cv.mobileNumber || ctx.config?.phone || '');
  await safeFill(page.locator('input[name="city"], input[placeholder*="City" i]'), cv.city || cv.location || 'Lagos');

  // 2. Select Country if not already selected
  try {
    const countryBtn = page.locator('button[id*="_form-item"]:has-text("country"), button:has-text("Select a country")').first();
    if (await countryBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      const countryText = await countryBtn.innerText().catch(() => '');
      if (!countryText || /select a country|select option/i.test(countryText)) {
        await countryBtn.click();
        await page.waitForTimeout(500);
        const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="country" i]').first();
        const countryTarget = cv.country || 'Nigeria';
        if (await searchInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          await searchInput.fill(countryTarget);
          await page.waitForTimeout(400);
        }
        const opt = page.locator(`[role="option"]:has-text("${countryTarget}"), [data-radix-collection-item]:has-text("${countryTarget}")`).first();
        if (await opt.isVisible({ timeout: 1000 }).catch(() => false)) {
          await opt.click();
          console.log(`[bruntwork] Selected country: ${countryTarget}`);
        }
      }
    }
  } catch { /* country select not present or already set */ }

  // 3. Resume upload
  try {
    if (ctx.resumePath) {
      const fileInputs = await page.locator('input[type="file"]').all();
      telemetry.resume.attempted = fileInputs.length > 0;
      telemetry.resume.path = ctx.resumePath;
      telemetry.resume.inputsDetected = fileInputs.length;
      for (const fi of fileInputs) {
        const uploaded = await fi.setInputFiles(ctx.resumePath).then(() => true).catch(() => false);
        if (uploaded) telemetry.resume.uploadsSucceeded += 1;
      }
      telemetry.resume.uploaded = telemetry.resume.uploadsSucceeded > 0;
      console.log(`[bruntwork] Resume upload: detected=${telemetry.resume.inputsDetected}, succeeded=${telemetry.resume.uploadsSucceeded}`);
      await page.waitForTimeout(1500);
    }
  } catch { /* ignore */ }

  // 4. Job-qualification textareas — use AI to generate human answers based on CV + question
  const textareas = await page.locator('textarea:visible').all();
  const unansweredQuestions = [];
  for (const ta of textareas) {
    const name = await ta.getAttribute('name').catch(() => '');
    if (name.includes('recaptcha')) continue;
    const cur = await ta.inputValue().catch(() => '');
    if (cur && cur.trim().length > 0) continue; // already filled, skip

    // Extract the question/label for this textarea
    let question = '';
    try {
      question = await ta.evaluate((el) => {
        const id = el.getAttribute('id');
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        if (label) return label.innerText;
        const wrap = el.closest('div');
        return wrap ? (wrap.innerText || '').slice(0, 300) : '';
      });
    } catch { /* ignore */ }

    if (!question || question.trim().length === 0) continue; // no question found, skip
    unansweredQuestions.push({ ta, question });
  }

  // AI response generation
  const answerConcurrency = clampNumber(process.env.BRUNTWORK_ANSWER_CONCURRENCY, 3, 1, 5);
  const generatedAnswers = await mapWithConcurrency(
    unansweredQuestions,
    answerConcurrency,
    ({ question }) => answerApplicationQuestion(question, ctx, cv)
  );

  for (let index = 0; index < unansweredQuestions.length; index += 1) {
    const { ta, question } = unansweredQuestions[index];
    const answerResult = generatedAnswers[index];
    const answer = answerResult.answer;
    if (answer && answer.length > 20) {
      const filled = await ta.fill(answer).then(async () => {
        await ta.dispatchEvent('input', { bubbles: true }).catch(() => {});
        await ta.dispatchEvent('change', { bubbles: true }).catch(() => {});
        await ta.dispatchEvent('blur', { bubbles: true }).catch(() => {});
        return true;
      }).catch(() => false);
      if (filled) {
        telemetry.questions.answered += 1;
        telemetry.questions.items.push({
          question: compactQuestion(question),
          provider: answerResult.provider,
          usedFallback: answerResult.usedFallback,
          validationReplaced: answerResult.validationReplaced,
          answerPreview: compactAnswer(answer)
        });
        console.log(`[bruntwork] Answered question ${telemetry.questions.answered}/${textareas.length} via ${answerResult.provider}${answerResult.usedFallback ? ' (fallback)' : ''}: ${compactQuestion(question)}`);
      }
      await page.waitForTimeout(150);
    }
  }
  telemetry.questions.visible = textareas.length;

  // 5. Voice & Video recording links
  const voiceFilled = await safeFill(
    page.locator('input[name="voiceRecordingLink"], input[placeholder*="voice" i], input[placeholder*="recording" i], input[placeholder*="audio" i]'),
    cv.voiceRecordingUrl || ctx.config?.voiceRecordingUrl || ''
  );
  if (voiceFilled) telemetry.fields.voiceRecordingFilled += 1;

  await safeFill(
    page.locator('input[name="videoRecordingLink"], input[placeholder*="video" i]'),
    cv.videoRecordingUrl || ctx.config?.videoRecordingUrl || ''
  );

  // 6. RAM selection (Radix Combobox or native Select)
  try {
    const ramCombobox = page.locator('button[role="combobox"]').first();
    if (await ramCombobox.isVisible({ timeout: 1000 }).catch(() => false)) {
      const btnText = await ramCombobox.innerText().catch(() => '');
      if (/select option|select ram/i.test(btnText)) {
        await ramCombobox.click();
        await page.waitForTimeout(400);
        const ramOpt = page.locator('[role="option"]:has-text("16 GB"), [role="option"]:has-text("More than 16GB"), [role="option"]:has-text("8 GB")').first();
        if (await ramOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
          await ramOpt.click();
          console.log('[bruntwork] Selected RAM option');
          await page.waitForTimeout(300);
        }
      }
    }

    const allSelects = await page.locator('select:visible').all();
    telemetry.fields.selectsSeen = allSelects.length;
    for (const sel of allSelects) {
      const cur = await sel.inputValue().catch(() => '');
      if (cur && cur !== '') continue;
      const opts = await sel.evaluate((el) => Array.from(el.options).map((o) => o.value).filter((v) => v && v !== '0'));
      if (opts.length > 0) {
        const selected = await sel.selectOption(opts[0]).then(() => true).catch(() => false);
        if (selected) telemetry.fields.selectsFilled += 1;
      }
    }
  } catch { /* ignore */ }

  // 7. Salary fields (support text inputs with regex and number inputs)
  const currentRate = String(cv.currentSalary || ctx.config?.salary?.current || 800);
  const expectedRate = String(cv.expectedSalary || ctx.config?.salary?.expected || 1200);

  await safeFill(page.locator('input[name="currentMonthlyPayRateUsd"], input[placeholder*="Current Salary" i]'), currentRate);
  await safeFill(page.locator('input[name="expectedMonthlyPayRateUsd"], input[placeholder*="Expected Salary" i]'), expectedRate);

  const numInputs = await page.locator('input[type="number"]:visible').all();
  telemetry.fields.numberInputsSeen = numInputs.length;
  let nIdx = 0;
  for (const ni of numInputs) {
    const cur = await ni.inputValue().catch(() => '');
    if (cur && cur !== '' && cur !== '0') { nIdx += 1; continue; }
    const filled = await ni.fill(nIdx === 0 ? currentRate : expectedRate).then(() => true).catch(() => false);
    if (filled) telemetry.fields.numberInputsFilled += 1;
    nIdx += 1;
  }

  telemetry.fields.completedAt = new Date().toISOString();
  await persistTelemetry(ctx);
  await page.waitForTimeout(800);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function answerApplicationQuestion(question, ctx, cv) {
  const fallback = buildGroundedFallbackAnswer(question, ctx.answers || {}, ctx.config || {}, cv);

  try {
    const cvSummary = `Name: ${cv.name || 'N/A'}
Summary: ${cv.summary || cv.rawTextPreview || 'N/A'}
Experience: ${cv.experience || cv.yearsOfExperience || 'N/A'}
Skills: ${(cv.skills || []).join(', ') || 'N/A'}
Education: ${Array.isArray(cv.education) ? cv.education.map((item) => JSON.stringify(item)).join(' ') : cv.education || 'N/A'}`;

    const prompt = `Return JSON only in this shape: {"answer":"..."}.

You are helping a job applicant answer an application question. Generate a natural, honest answer based only on the candidate CV and profile.

Question: ${question}

Candidate CV:
${cvSummary}

Instructions:
- Write 2-4 sentences maximum.
- Start the answer immediately. Do NOT use conversational filler or preambles like "Here is my answer", "Based on the CV", or "As an AI".
- No bullet points, no dashes, no lists.
- Do not invent skills, tools, degrees, years of experience, countries, or certifications.
- If the CV does not prove the requested exact experience, say that the exact experience is not documented and mention transferable skills instead.
- Keep it under 200 words.`;

    const aiResult = await aiRequest({
      taskType: TaskTypes.APPLICATION_WRITING,
      prompt,
      profile: { profileName: ctx.config?.profileName || 'default' },
      jobData: ctx.job || {},
      config: ctx.config || {}
    });

    const cleaned = cleanApplicationAnswer(aiResult.response || '');
    const validated = validateApplicationAnswer({
      question,
      answer: cleaned,
      config: ctx.config || {},
      candidate: cv,
      fallback
    });

    if (!validated.ok) {
      console.warn(`[bruntwork] Replaced unsupported answer claim for "${String(question).slice(0, 50)}...": ${validated.reason}`);
    }

    return {
      answer: validated.answer || fallback,
      provider: aiResult.modelUsed || 'local-fallback',
      usedFallback: Boolean(aiResult.fallbackUsed),
      validationReplaced: !validated.ok
    };
  } catch (err) {
    console.warn(`[bruntwork] AI answer failed, using grounded fallback: ${err.message}`);
    return {
      answer: fallback,
      provider: 'local-fallback',
      usedFallback: true,
      validationReplaced: false
    };
  }
}

function pickAnswer(prompt, answers, fallback) {
  if (!answers || typeof answers !== 'object') return fallback;
  const p = (prompt || '').toLowerCase();
  if (/experience|describe.*role|background/.test(p) && answers.describe_experience) return answers.describe_experience;
  if (/skill|tool|software|system/.test(p) && answers.relevant_skills) return answers.relevant_skills;
  if (/why.*you|why.*role|interest/.test(p) && answers.why_interested) return answers.why_interested;
  return answers.general || fallback;
}

// --- step advance -----------------------------------------------------------

async function advance(page, step, ctx) {
  if (step === FormStep.EMAIL) {
    return clickContinue(page, ctx);
  }
  if (step === FormStep.DETAILS) {
    return clickSubmitApplication(page, ctx);
  }
  if (step === FormStep.UNKNOWN) {
    return openApplyPageFromJobPage(page, ctx);
  }
  return { step, advanced: false, reason: `No advance handler for step ${step}.` };
}

async function openApplyPageFromJobPage(page, ctx) {
  const currentUrl = normalizeUrl(page.url());
  const baseUrl = normalizeUrl(ctx.job?.applicationUrl || currentUrl);
  const applyUrl = /\/apply(\?|#|$)/i.test(baseUrl) ? baseUrl : baseUrl.replace(/\/?$/, '/apply');

  if (!/bruntwork(careers)?\.co\/jobs\/[^/]+/i.test(applyUrl)) {
    return { step: FormStep.UNKNOWN, advanced: false, reason: 'Not on a BruntWork job page; cannot navigate to apply form.' };
  }

  // Already on the apply URL; don't loop — let the caller decide if the page is truly unclassifiable.
  if (applyUrl === currentUrl) {
    return { step: FormStep.UNKNOWN, advanced: false, reason: 'Already on the computed apply URL but step is still unclassifiable.' };
  }

  try {
    console.log(`[bruntwork] Navigating from job page to apply form: ${applyUrl}`);
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Wait for the BruntWork SPA to render the email form (or a clear success/already-applied state).
    const settled = await Promise.race([
      page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => 'email'),
      page.locator('body').innerText({ timeout: 3000 }).then((body) => {
        if (/already (submitted|applied)|application (was )?successfully submitted|we (have|'ve|ve) received your application|thank you for your application|enhance your application|strengthen your application/i.test(body)) return 'submitted';
        return null;
      }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 15000))
    ]);

    if (settled === 'submitted') {
      return { step: FormStep.SUBMITTED, advanced: true, reason: 'Navigated to apply URL and found already-submitted/success state.' };
    }

    await page.waitForTimeout(800);
    return { step: FormStep.EMAIL, advanced: true, reason: 'Navigated from job page to apply form.' };
  } catch (err) {
    return { step: FormStep.UNKNOWN, advanced: false, reason: `Failed to navigate to apply form: ${err.message}` };
  }
}

function normalizeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString().toLowerCase();
  } catch {
    return String(value).split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
  }
}

async function clickContinue(page, ctx) {
  const beforeUrl = page.url();
  const btn = page.getByRole('button', { name: /^continue$/i }).first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step: FormStep.EMAIL, advanced: false, reason: 'Continue button not visible.' };
  }
  if (await btn.isDisabled().catch(() => false)) {
    return { step: FormStep.EMAIL, advanced: false, reason: 'Continue button is disabled (email likely invalid).' };
  }
  await btn.click();

  // Wait for URL to change to /applications/ (BruntWork SPA takes time to transition)
  const continueWaitMs = clampNumber(process.env.BRUNTWORK_CONTINUE_WAIT_MS, 60000, 15000, 80000);
  const urlChanged = await page.waitForURL(/\/applications\//, { timeout: continueWaitMs }).then(() => true).catch(() => false);
  if (urlChanged) {
    // Give the page time to render after URL change
    await page.waitForTimeout(2000);
    return { step: FormStep.DETAILS, advanced: true, reason: '' };
  }

  // Fallback: use the old transition detection
  const transitioned = await waitForTransition(page, beforeUrl, FormStep.DETAILS, Math.min(continueWaitMs, 30000));
  return { step: transitioned ? FormStep.DETAILS : FormStep.EMAIL, advanced: transitioned, reason: transitioned ? '' : 'No transition observed after Continue.' };
}

async function clickSubmitApplication(page, ctx) {
  const btn = page.getByRole('button', { name: /submit\s*application/i }).first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) {
    const requiredIssues = await collectVisibleRequiredIssues(page);
    return {
      step: FormStep.DETAILS,
      advanced: false,
      reason: detailsReason('Submit Application button not visible.', requiredIssues),
      requiredIssues
    };
  }
  // The button is disabled until the form passes client-side validation.
  // If it's still disabled, that means the bot failed to fill some required field.
  // Wait up to 8s for it to enable (some validations are async).
  const deadline = Date.now() + 8000;
  let everEnabled = false;
  while (Date.now() < deadline) {
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled) {
      everEnabled = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (await btn.isDisabled().catch(() => true)) {
    if (everEnabled) {
      const pendingSubmission = await detectPendingSubmission(page, btn);
      if (pendingSubmission.pending) {
        return {
          step: FormStep.SUBMITTED,
          advanced: true,
          reason: pendingSubmission.reason,
          pendingSubmission: true
        };
      }
    }
    const requiredIssues = await collectVisibleRequiredIssues(page);
    return {
      step: FormStep.DETAILS,
      advanced: false,
      reason: detailsReason('Submit Application stayed disabled; required field(s) are likely incomplete.', requiredIssues),
      requiredIssues
    };
  }
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();
  const beforeUrl = page.url();
  const transitioned = await waitForTransition(page, beforeUrl, FormStep.SUBMITTED, 30000);
  if (transitioned) {
    return { step: FormStep.SUBMITTED, advanced: true, reason: '' };
  }

  const pendingSubmission = await detectPendingSubmission(page, btn);
  if (pendingSubmission.pending) {
    return {
      step: FormStep.SUBMITTED,
      advanced: true,
      reason: pendingSubmission.reason,
      pendingSubmission: true
    };
  }

  // Even if no transition was detected, CAPTCHA may have intercepted. The caller
  // (automation.js) will run a CAPTCHA pass and then re-check isSubmitted.
  return {
    step: FormStep.DETAILS,
    advanced: false,
    reason: 'No SUBMITTED markers seen yet — CAPTCHA or async submit may still be in flight.'
  };
}

async function collectVisibleRequiredIssues(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const labelFor = (el) => {
      const id = el.getAttribute('id');
      const explicit = id && window.CSS?.escape ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const wrapper = el.closest('label, [role="group"], .field, .form-group, div');
      return [
        explicit?.textContent,
        el.closest('label')?.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('name'),
        el.getAttribute('id'),
        wrapper?.textContent
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    };
    const optionalLike = /optional|voice|audio|video|loom|photo|screenshot|speed.?test|internet|device/i;
    const fields = Array.from(document.querySelectorAll('input, textarea, select'));

    return fields
      .filter((el) => visible(el) && !el.disabled)
      .map((el) => {
        const type = (el.getAttribute('type') || el.tagName).toLowerCase();
        const key = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`;
        if (/captcha|recaptcha|h-captcha/i.test(key)) return null;
        if (type === 'hidden' || type === 'submit' || type === 'button') return null;

        const label = labelFor(el);
        const isFile = type === 'file';
        const value = isFile ? (el.files?.length ? 'uploaded' : '') : (el.value || '');
        const invalid = el.getAttribute('aria-invalid') === 'true' || Boolean(el.validationMessage);
        const required = el.required || /\brequired\b/i.test(label);
        const emptyRequiredLike = !value.trim() && (required || !optionalLike.test(label));
        if (!invalid && !emptyRequiredLike) return null;

        return {
          label: label || key.trim() || type,
          type,
          required,
          invalid,
          validation: el.validationMessage || ''
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  }).catch(() => []);
}

function detailsReason(baseReason, requiredIssues = []) {
  if (!requiredIssues.length) return baseReason;
  const summary = requiredIssues
    .slice(0, 5)
    .map((issue) => issue.label)
    .filter(Boolean)
    .join('; ');
  return `${baseReason} Visible incomplete/invalid fields: ${summary || 'unknown fields'}.`;
}

async function waitForTransition(page, beforeUrl, expectedStep, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    const cur = await getCurrentStep(page);
    if (cur === expectedStep) return true;
    if (expectedStep === FormStep.SUBMITTED && cur === FormStep.SUBMITTED) return true;
    if (expectedStep === FormStep.DETAILS && page.url() !== beforeUrl && cur !== FormStep.EMAIL) return true;
  }
  return false;
}

async function detectPendingSubmission(page, submitButton) {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const proof = await isSubmitted(page);
  if (proof.submitted) {
    return {
      pending: true,
      reason: `Submission markers detected after async settle: ${proof.markers.join(', ')}`
    };
  }

  const submitVisible = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
  const submitDisabled = await submitButton.isDisabled().catch(() => false);
  const requiredIssues = await collectVisibleRequiredIssues(page);
  const blockingCaptcha = await page
    .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  const likelySubmitted = (!submitVisible || submitDisabled) && requiredIssues.length === 0 && !blockingCaptcha;
  if (!likelySubmitted) {
    return { pending: false, reason: '' };
  }

  const currentUrl = page.url();
  const urlChanged = currentUrl !== '';
  const routeLooksAdvanced = /\/applications\/[A-Za-z0-9-]+(?:\/enhance)?/i.test(currentUrl);
  if (routeLooksAdvanced || urlChanged) {
    return {
      pending: true,
      reason: 'Submit control is no longer actionable and the Bruntwork application page appears to have advanced; handing off to ground-truth re-verification.'
    };
  }

  return { pending: false, reason: '' };
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const n = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(n, min), max);
}

// --- submission proof -------------------------------------------------------

async function isSubmitted(page) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const markers = [];

  const successMatch = body.match(SUCCESS_TEXT_PATTERN);
  if (successMatch) {
    markers.push(`body matched success phrase: "${successMatch[0]}"`);
  }
  if (/\/applications\/[^/]+\/(success|complete|thank)/i.test(url)) {
    markers.push(`URL matched success route: ${url}`);
  }

  if (markers.length > 0) return proofFound(markers);
  return noProof('No BruntWork success markers detected on page.');
}

// --- ground-truth re-verification -------------------------------------------

async function verifySubmission(ctx, options = {}) {
  const job = ctx.job || {};
  const email = ctx.candidate?.email || ctx.config?.applicantEmail || '';
  const jobUrl = job.applicationUrl || '';
  if (!email || !jobUrl) {
    return { proof: Proof.INCONCLUSIVE, markers: [], reason: 'Missing email or job URL for re-verification.' };
  }
  // Make sure we hit the /apply form route, not the JD page
  const applyUrl = /\/apply(\?|$)/.test(jobUrl) ? jobUrl : jobUrl.replace(/\/?$/, '/apply');

  let browser;
  let ctxBrowser;
  let page = options.page;
  if (!page) {
    browser = await chromium.launch({ headless: true });
    ctxBrowser = await browser.newContext();
    page = await ctxBrowser.newPage();
  }
  try {
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const emailInput = page.locator('input[type="email"]').first();
    if (!(await emailInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      return { proof: Proof.INCONCLUSIVE, markers: [], reason: 'No email input on apply URL during re-verification.' };
    }
    await emailInput.fill(email);
    await page.waitForTimeout(400);

    const cont = page.getByRole('button', { name: /^continue$/i }).first();
    if (!(await cont.isVisible({ timeout: 3000 }).catch(() => false))) {
      return { proof: Proof.INCONCLUSIVE, markers: [], reason: 'No Continue button on apply URL during re-verification.' };
    }
    await cont.click();

    const transitionedToApplication = typeof page.waitForURL === 'function'
      ? await page.waitForURL(/\/applications\//, { timeout: 15000 }).then(() => true).catch(() => false)
      : /\/applications\//.test(page.url());
    if (!transitionedToApplication) {
      const successBody = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      if (SUCCESS_TEXT_PATTERN.test(successBody)) {
        return { proof: Proof.CONFIRMED, markers: ['re-verify body matched already-submitted phrase before URL transition'], reason: '' };
      }
    }

    // Wait for SPA to settle
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const afterUrl = page.url();
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

    // Strong CONFIRMED markers: BruntWork tells us we've already applied / submitted
    if (/already (submitted|applied)|application (was )?successfully submitted|we (have|'ve|ve) received your application|thank you for your application|you have already submitted/i.test(body)) {
      return { proof: Proof.CONFIRMED, markers: ['re-verify body matched already-submitted phrase'], reason: '' };
    }
    if (/\/applications\/[^/]+\/enhance(?:[/?#]|$)/i.test(afterUrl)) {
      return { proof: Proof.CONFIRMED, markers: [`re-verify landed on enhance route: ${afterUrl}`], reason: '' };
    }

    // Strong NOT_SUBMITTED markers: BruntWork dropped us back into the apply form
    //   - Submit Application visible OR DETAILS step with empty/draft form
    const submitVisible = await page.getByRole('button', { name: /submit\s*application/i }).first().isVisible({ timeout: 1500 }).catch(() => false);
    const step = await getCurrentStep(page);
    const emptyRequiredFields = await countEmptyRequiredApplicationFields(page);
    if (submitVisible || emptyRequiredFields > 0) {
      return {
        proof: Proof.NOT_SUBMITTED,
        markers: [`re-verify landed on ${step} step with submit visible=${submitVisible}, empty required fields=${emptyRequiredFields}`],
        reason: 'Re-entering the same email returned us to an editable application form - submission did not stick.'
      };
    }

    if (step === FormStep.DETAILS) {
      if (/\/applications\/[^/]+(?:[/?#]|$)/i.test(afterUrl) && !submitVisible && emptyRequiredFields === 0) {
        return {
          proof: Proof.CONFIRMED,
          markers: [`re-verify landed on non-editable application route: ${afterUrl}`],
          reason: ''
        };
      }
      return {
        proof: Proof.INCONCLUSIVE,
        markers: [`re-verify landed on ${step} step without submit control or empty required fields`],
        reason: 'Re-verification reached a BruntWork application page, but it was not clearly an editable unsubmitted form.'
      };
    }

    // Still on EMAIL or UNKNOWN — couldn't decide
    return {
      proof: Proof.INCONCLUSIVE,
      markers: [`re-verify final step: ${step}`],
      reason: 'Re-verification could not determine application state.'
    };
  } catch (err) {
    return { proof: Proof.INCONCLUSIVE, markers: [], reason: `Re-verification error: ${err.message}` };
  } finally {
    await ctxBrowser?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function countEmptyRequiredApplicationFields(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const optionalLike = /optional|voice|audio|video|loom|photo|screenshot|speed.?test|internet|device|enhance|strengthen/i;
    return Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((el) => visible(el) && !el.disabled)
      .filter((el) => {
        const type = (el.getAttribute('type') || el.tagName).toLowerCase();
        const key = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`;
        if (/captcha|recaptcha|h-captcha/i.test(key)) return false;
        if (['hidden', 'submit', 'button'].includes(type)) return false;
        const label = [
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('name'),
          el.getAttribute('id'),
          el.closest('label, div')?.textContent
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        const value = type === 'file' ? (el.files?.length ? 'uploaded' : '') : (el.value || '');
        return !value.trim() && (el.required || /\brequired\b/i.test(label)) && !optionalLike.test(label);
      }).length;
  }).catch(() => 0);
}

function getTelemetry(ctx) {
  if (!ctx.__bruntworkTelemetry) {
    ctx.__bruntworkTelemetry = {
      site: NAME,
      jobTitle: ctx.job?.title || '',
      profileName: ctx.config?.profileName || 'default',
      updatedAt: new Date().toISOString(),
      resume: {
        attempted: false,
        path: '',
        inputsDetected: 0,
        uploadsSucceeded: 0,
        uploaded: false
      },
      questions: {
        visible: 0,
        answered: 0,
        items: []
      },
      fields: {
        voiceRecordingFilled: 0,
        selectsSeen: 0,
        selectsFilled: 0,
        numberInputsSeen: 0,
        numberInputsFilled: 0,
        completedAt: ''
      }
    };
  }
  ctx.__bruntworkTelemetry.updatedAt = new Date().toISOString();
  return ctx.__bruntworkTelemetry;
}

async function persistTelemetry(ctx) {
  if (!ctx?.debugDir) return;
  const telemetry = getTelemetry(ctx);
  try {
    await fs.mkdir(ctx.debugDir, { recursive: true });
    await fs.writeFile(
      path.join(ctx.debugDir, 'bruntwork_telemetry.json'),
      `${JSON.stringify(telemetry, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Debug telemetry should never break the application flow.
  }
}

function compactQuestion(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function compactAnswer(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export const bruntworkAdapter = Object.freeze({
  name: NAME,
  matches,
  flowTimeoutMs: 360000,
  advanceTimeoutMs: 90000,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default bruntworkAdapter;
