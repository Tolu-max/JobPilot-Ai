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

import { chromium } from 'playwright';
import { FormStep, Proof, noProof, proofFound } from './types.js';
import { request as aiRequest, TaskTypes } from '../aiRouter.js';
import {
  buildGroundedFallbackAnswer,
  cleanApplicationAnswer,
  validateApplicationAnswer
} from '../applicationAnswerGuard.js';

const NAME = 'bruntwork';
const SUCCESS_TEXT_PATTERN = /your application has been submitted|application (was )?successfully submitted|thank you for your application|we (have|'ve|ve) received your application|application is complete|enhance your application|our team is reviewing your profile|strengthen your application/i;

function matches(url) {
  if (!url) return false;
  return /bruntwork(careers)?\.co/i.test(url) || /apply\.bruntwork/i.test(url);
}

// --- step detection ---------------------------------------------------------

async function getCurrentStep(page) {
  // Cheapest signal first: visible body text + url + visible inputs.
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');

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
  //  - EMAIL step: URL contains /apply, exactly one email input visible, no Submit Application button
  //  - DETAILS step: URL contains /applications/{id}, lots of inputs visible, Submit Application present (possibly disabled)
  const onApplyRoute = /\/jobs\/[^/]+\/apply/i.test(url);
  const onApplicationRoute = /\/applications\/[A-Za-z0-9-]+/i.test(url);

  // Count visible inputs (rough proxy)
  const visibleInputCount = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) n += 1;
    });
    return n;
  }).catch(() => 0);

  if (onApplyRoute && visibleInputCount <= 2 && !submitVisible) {
    return FormStep.EMAIL;
  }

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
  // BruntWork pre-fills general info (name, phone, city, country) from previous applications.
  // DO NOT touch these fields — they're already correct.
  // ONLY fill: Resume upload, Job questions (AI-generated), and other empty fields.

  const cv = ctx.candidate || {};

  // safeFill: only fill if field is currently empty
  const safeFill = async (locator, value) => {
    if (!value) return false;
    try {
      const el = locator.first();
      if (await el.isVisible({ timeout: 1500 })) {
        const current = await el.inputValue().catch(() => '');
        if (current && current.trim().length > 0) return false; // already filled, skip
        await el.fill(value);
        await page.waitForTimeout(120);
        return true;
      }
    } catch { /* not present on this form */ }
    return false;
  };

  // Resume upload
  try {
    if (ctx.resumePath) {
      const fileInputs = await page.locator('input[type="file"]').all();
      for (const fi of fileInputs) {
        await fi.setInputFiles(ctx.resumePath).catch(() => {});
      }
      await page.waitForTimeout(2000);
    }
  } catch { /* ignore */ }

  // Job-qualification textareas — use AI to generate human answers based on CV + question
  const textareas = await page.locator('textarea:visible').all();
  for (const ta of textareas) {
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

    const answer = await answerApplicationQuestion(question, ctx, cv);
    if (answer && answer.length > 20) {
      await ta.fill(answer).catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  // Voice recording link
  await safeFill(
    page.locator('input[placeholder*="voice" i], input[placeholder*="recording" i], input[placeholder*="audio" i]'),
    cv.voiceRecordingUrl || ctx.config?.voiceRecordingUrl || ''
  );

  // Remaining selects (RAM dropdown etc.) — pick first non-empty option
  try {
    const allSelects = await page.locator('select:visible').all();
    for (const sel of allSelects) {
      const cur = await sel.inputValue().catch(() => '');
      if (cur && cur !== '') continue;
      const opts = await sel.evaluate((el) => Array.from(el.options).map((o) => o.value).filter((v) => v && v !== '0'));
      if (opts.length > 0) await sel.selectOption(opts[0]).catch(() => {});
    }
  } catch { /* ignore */ }

  // Salary fields
  const currentRate = String(cv.currentSalary || ctx.config?.salary?.current || 800);
  const expectedRate = String(cv.expectedSalary || ctx.config?.salary?.expected || 1200);
  const numInputs = await page.locator('input[type="number"]:visible').all();
  let nIdx = 0;
  for (const ni of numInputs) {
    const cur = await ni.inputValue().catch(() => '');
    if (cur && cur !== '' && cur !== '0') { nIdx += 1; continue; }
    await ni.fill(nIdx === 0 ? currentRate : expectedRate).catch(() => {});
    nIdx += 1;
  }

  await page.waitForTimeout(800);
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

    return validated.answer || fallback;
  } catch (err) {
    console.warn(`[bruntwork] AI answer failed, using grounded fallback: ${err.message}`);
    return fallback;
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
  return { step, advanced: false, reason: `No advance handler for step ${step}.` };
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
  const urlChanged = await page.waitForURL(/\/applications\//, { timeout: 15000 }).then(() => true).catch(() => false);
  if (urlChanged) {
    // Give the page time to render after URL change
    await page.waitForTimeout(2000);
    return { step: FormStep.DETAILS, advanced: true, reason: '' };
  }

  // Fallback: use the old transition detection
  const transitioned = await waitForTransition(page, beforeUrl, FormStep.DETAILS);
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
  while (Date.now() < deadline) {
    if (!(await btn.isDisabled().catch(() => true))) break;
    await page.waitForTimeout(500);
  }
  if (await btn.isDisabled().catch(() => true)) {
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
  const transitioned = await waitForTransition(page, page.url(), FormStep.SUBMITTED);
  // Even if no transition was detected, CAPTCHA may have intercepted. The caller
  // (automation.js) will run a CAPTCHA pass and then re-check isSubmitted.
  return { step: transitioned ? FormStep.SUBMITTED : FormStep.DETAILS, advanced: transitioned, reason: transitioned ? '' : 'No SUBMITTED markers seen yet — CAPTCHA or async submit may still be in flight.' };
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

async function waitForTransition(page, beforeUrl, expectedStep) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    const cur = await getCurrentStep(page);
    if (cur === expectedStep) return true;
    if (expectedStep === FormStep.SUBMITTED && cur === FormStep.SUBMITTED) return true;
    if (expectedStep === FormStep.DETAILS && page.url() !== beforeUrl && cur !== FormStep.EMAIL) return true;
  }
  return false;
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

async function verifySubmission(ctx) {
  const job = ctx.job || {};
  const email = ctx.candidate?.email || ctx.config?.applicantEmail || '';
  const jobUrl = job.applicationUrl || '';
  if (!email || !jobUrl) {
    return { proof: Proof.INCONCLUSIVE, markers: [], reason: 'Missing email or job URL for re-verification.' };
  }
  // Make sure we hit the /apply form route, not the JD page
  const applyUrl = /\/apply(\?|$)/.test(jobUrl) ? jobUrl : jobUrl.replace(/\/?$/, '/apply');

  const browser = await chromium.launch({ headless: true });
  const ctxBrowser = await browser.newContext();
  const page = await ctxBrowser.newPage();
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
    // Wait for SPA to settle
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(3500);

    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

    // Strong CONFIRMED markers: BruntWork tells us we've already applied / submitted
    if (/already (submitted|applied)|application (was )?successfully submitted|we (have|'ve|ve) received your application|thank you for your application|you have already submitted|enhance your application|our team is reviewing your profile|strengthen your application/i.test(body)) {
      return { proof: Proof.CONFIRMED, markers: ['re-verify body matched already-submitted phrase'], reason: '' };
    }

    // Strong NOT_SUBMITTED markers: BruntWork dropped us back into the apply form
    //   - Submit Application visible OR DETAILS step with empty/draft form
    const submitVisible = await page.getByRole('button', { name: /submit\s*application/i }).first().isVisible({ timeout: 1500 }).catch(() => false);
    const step = await getCurrentStep(page);
    if (submitVisible || step === FormStep.DETAILS) {
      return {
        proof: Proof.NOT_SUBMITTED,
        markers: [`re-verify landed on ${step} step with submit visible=${submitVisible}`],
        reason: 'Re-entering the same email returned us to the application form — submission did not stick.'
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
    await ctxBrowser.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export const bruntworkAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default bruntworkAdapter;
