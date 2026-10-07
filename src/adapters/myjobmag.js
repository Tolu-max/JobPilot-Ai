import { FormStep, Proof, noProof } from './types.js';
import { solveCaptchaAuto } from '../captchaSolver.js';

const NAME = 'myjobmag';

function matches(url) {
  return /myjobmag\.com/i.test(String(url || ''));
}

const SUBMITTED_REGEX = /application (sent|submitted|received)|successfully applied|thank you for applying|your application has been sent|application successful|application was successfully sent|application received/i;

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function getCurrentStep(page, ctx = {}) {
  const url = page.url();
  const body = await bodyText(page);

  if (SUBMITTED_REGEX.test(body) || /application-success|applied/i.test(url)) {
    return FormStep.SUBMITTED;
  }

  const hasForm = await page.locator('#d-apply-form, form[action*="job-application"]').isVisible({ timeout: 1500 }).catch(() => false);
  if (hasForm || /\/job-application\//i.test(url)) {
    return FormStep.DETAILS;
  }

  const applyButton = page.locator('a.apply-but, a[href*="/job-application/"], a[href*="/apply-now/"]');
  const hasApplyButton = await applyButton.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (hasApplyButton || /\/job\//i.test(url)) {
    return FormStep.DETAILS;
  }

  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx = {}) {
  const url = page.url();

  // If on listing or detail page, click "Apply Now" to open application form
  if (!/\/job-application\//i.test(url)) {
    const applyButton = page.locator('a.apply-but, a[href*="/job-application/"]').first();
    const isVisible = await applyButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      const applyHref = await applyButton.getAttribute('href').catch(() => '');
      if (applyHref) {
        const targetUrl = new URL(applyHref, page.url()).toString();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(1500);
      } else {
        await applyButton.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
  }

  const form = page.locator('#d-apply-form, form[action*="job-application"]').first();
  const formVisible = await form.isVisible({ timeout: 5000 }).catch(() => false);
  if (!formVisible) {
    return { step, advanced: false, reason: 'Application form not found or external redirect required.' };
  }

  const candidate = ctx.candidate || {};
  const config = ctx.config || {};

  const fullName = candidate.name || config.candidateName || config.displayName || 'Candidate';
  const email = candidate.email || config.applicantEmail || '';
  const phone = candidate.phone || candidate.phoneNumber || '(+234) 07062187105';
  const coverLetter = ctx.coverLetter || candidate.summary || 'I am excited to apply for this position and contribute my skills and experience.';

  // 1. Full Name
  const nameInput = page.locator('input[name="sender_name"]').first();
  if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInput.fill(fullName);
  }

  // 2. Email Address
  const emailInput = page.locator('input[name="sender_email"]').first();
  if (await emailInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emailInput.fill(email);
  }

  // 3. Phone Number
  const phoneInput = page.locator('input[name="sender_phone"]').first();
  if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await phoneInput.fill(phone);
  }

  // 4. Experience Dropdown (years)
  const expSelect = page.locator('select[name="sender_experience"]').first();
  if (await expSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    const years = candidate.yearsOfExperience || 3;
    const valueStr = String(Math.min(Math.max(1, years), 10));
    await expSelect.selectOption({ value: valueStr }).catch(async () => {
      await expSelect.selectOption({ index: 3 }).catch(() => {});
    });
  }

  // 5. Location Dropdown (Nigerian state)
  const locSelect = page.locator('select[name="sender_location"]').first();
  if (await locSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    const stateCandidate = String(candidate.city || candidate.address || candidate.location || '').toLowerCase();
    let locationVal = '154'; // Lagos default
    if (stateCandidate.includes('kaduna')) locationVal = '170';
    else if (stateCandidate.includes('abuja')) locationVal = '155';
    else if (stateCandidate.includes('oyo') || stateCandidate.includes('ibadan')) locationVal = '180';
    else if (stateCandidate.includes('rivers') || stateCandidate.includes('port')) locationVal = '182';

    await locSelect.selectOption({ value: locationVal }).catch(async () => {
      await locSelect.selectOption({ index: 1 }).catch(() => {});
    });
  }

  // 6. Relocation Dropdown (Yes or No - required field)
  const relocSelect = page.locator('select[name="sender_relocation"]').first();
  if (await relocSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    // Candidates are remote-first / remote-only; default to '0' (No) unless explicitly true
    const willing = candidate.willingToRelocate === true ? '1' : '0';
    await relocSelect.selectOption({ value: willing }).catch(async () => {
      await relocSelect.selectOption({ index: 2 }).catch(() => {});
    });
  }

  // 7. Cover Letter Textarea
  const coverArea = page.locator('textarea[name="apply_body"]').first();
  if (await coverArea.isVisible({ timeout: 1000 }).catch(() => false)) {
    await coverArea.fill(coverLetter);
  }

  // 8. CV File Upload
  const resumePath = ctx.resumePath || candidate.resumePath;
  if (resumePath) {
    const fileInput = page.locator('input[type="file"][name="cv"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(resumePath).catch((err) => {
        console.warn(`[myjobmagAdapter] File upload skipped: ${err.message}`);
      });
    }
  }

  // 9. CAPTCHA Handling
  const captchaFrame = page.locator('iframe[src*="recaptcha"], .g-recaptcha').first();
  if (await captchaFrame.isVisible({ timeout: 1500 }).catch(() => false)) {
    console.log('[myjobmagAdapter] reCAPTCHA detected on application form, solving...');
    await solveCaptchaAuto(page, config).catch((err) => {
      console.warn(`[myjobmagAdapter] Captcha solve attempt error: ${err.message}`);
    });
  }

  return { step: FormStep.DETAILS, advanced: true };
}

async function advance(page, step, ctx = {}) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: true,
      reason: 'test_mode_stopped_before_submit'
    };
  }

  const submitButton = page.locator('#sub-app-but, input[name="submit_app"], input[type="submit"][value*="Send"]').first();
  const visible = await submitButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) {
    return { step, advanced: false, reason: 'Submit button not visible.' };
  }

  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      submitButton.click({ force: true })
    ]);
  } catch {
    await submitButton.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(3000);

  const nextStep = await getCurrentStep(page, ctx);
  return {
    step: nextStep,
    advanced: nextStep === FormStep.SUBMITTED
  };
}

async function isSubmitted(page, ctx = {}) {
  const body = await bodyText(page);
  const url = page.url();

  const markers = [];
  if (SUBMITTED_REGEX.test(body)) {
    markers.push('body_matched_submitted_phrase');
  }
  if (/application-success|applied/i.test(url)) {
    markers.push('url_matched_success_path');
  }

  if (markers.length > 0) {
    return { submitted: true, markers };
  }

  return { submitted: false, markers: [], reason: 'No positive submission confirmation detected.' };
}

async function verifySubmission(page, ctx = {}) {
  const check = await isSubmitted(page, ctx);
  if (check.submitted) {
    return {
      proof: Proof.CONFIRMED,
      markers: check.markers
    };
  }
  return noProof(check.reason || 'Verification inconclusive');
}

export default {
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
};
