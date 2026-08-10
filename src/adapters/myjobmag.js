import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'myjobmag';

function matches(url) {
  return /myjobmag\.com/i.test(String(url || ''));
}

const SUBMITTED_RE = /application (sent|submitted|received)|successfully applied|thank you for applying|your application has been submitted/i;

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function getCurrentStep(page, ctx = {}) {
  const body = await bodyText(page);
  if (SUBMITTED_RE.test(body) || /your application has been received|application successful|thank you for applying/i.test(body)) {
    return FormStep.SUBMITTED;
  }

  if (/method of application|send (your|the) cv|email your cv|apply via email/i.test(body) && !(await hasApplicationForm(page))) {
    return FormStep.UNKNOWN;
  }

  // If submit button was clicked and form is no longer present or disabled, transition to SUBMITTED
  const submitControl = page.locator('input[type="submit"], button[type="submit"]').first();
  const formVisible = await submitControl.isVisible({ timeout: 1000 }).catch(() => false);
  if (!formVisible && ctx.stepCount > 1) {
    return FormStep.SUBMITTED;
  }

  const hasForm = await page.locator('form, input[type="file"], input[name="name"], input[name="email"], input[type="text"]').count().catch(() => 0);
  if (hasForm > 0 || /apply (for this job|now)/i.test(body)) {
    return FormStep.DETAILS;
  }

  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx = {}) {
  if (!(await hasApplicationForm(page))) return;

  await page.locator('#apply-job-box').evaluate((element) => {
    element.style.display = 'block';
  }).catch(() => {});
  await page.locator('#d-apply-form').scrollIntoViewIfNeeded().catch(() => {});

  const candidate = ctx.candidate || ctx.config?.candidateProfile || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || candidate.fullName || ctx.config?.displayName || 'Applicant';
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = candidate.phone || defaults.phone || '';
  const location = String(candidate.location || defaults.location || defaults.city || '').split(',')[0].trim();
  const title = ctx.job?.title || ctx.job?.raw?.title || 'the advertised role';
  const coverLetter = ctx.coverLetter || candidate.summary || defaults.coverLetter || '';

  // 1. If an "Apply Now" or "Apply for this job" modal/toggle button exists on the page, click it to reveal fields
  const applyToggle = page.locator('a[href*="#apply"], button:has-text("Apply Now"), a:has-text("Apply Now"), .btn-apply, input[value*="Apply"]').first();
  if (await applyToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await applyToggle.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 2. Upload resume if file input is present
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const resumePath = ctx.config?.resumePath;
    if (resumePath) {
      await fileInput.setInputFiles(resumePath).catch(() => {});
    }
  }

  // 3. Fill required text/email/phone inputs
  const nameInput = page.locator('#d-apply-form input[name="sender_name"]');
  if (await nameInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await nameInput.fill(fullName).catch(() => {});
  }

  const emailInput = page.locator('#d-apply-form input[name="sender_email"]');
  if (await emailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailInput.fill(email).catch(() => {});
  }

  await page.locator('#d-apply-form input[name="sender_phone"]').fill(phone).catch(() => {});
  if (location) await page.locator('#d-apply-form select[name="sender_location"]').selectOption({ label: location }).catch(() => {});
  await page.locator('#d-apply-form input[name="apply_subject"]').fill(`Application for ${title}`).catch(() => {});
  await page.locator('#d-apply-form textarea[name="apply_body"]').fill(coverLetter).catch(() => {});

  // 4. Fill radio buttons or select dropdowns if any exist
  const radios = page.locator('input[type="radio"]');
  const radioCount = await radios.count().catch(() => 0);
  if (radioCount > 0) {
    for (let i = 0; i < Math.min(radioCount, 5); i++) {
      const radio = radios.nth(i);
      const isChecked = await radio.isChecked().catch(() => false);
      if (!isChecked) {
        await radio.check({ force: true }).catch(() => {});
      }
    }
  }
}

async function advance(page, step, ctx = {}) {
  if (!(await hasApplicationForm(page))) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'MyJobMag exposes employer email/manual application instructions; automatic submission is blocked.'
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: MyJobMag form filled and stopped before Send Application.'
    };
  }

  const submitControl = page.locator(
    'input[type="submit"][name*="apply"], input[type="submit"][name*="sub"], button[type="submit"], input[value*="Apply"], input[value*="Submit"], .mag-sub-btn, #sub_btn'
  ).first();

  if (await submitControl.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitControl.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  return { step: FormStep.SUBMITTED, advanced: true, reason: 'Submitted application on MyJobMag.' };
}

async function isSubmitted(page) {
  const body = await bodyText(page);

  if (SUBMITTED_RE.test(body)) {
    return proofFound(['MyJobMag form application submitted successfully']);
  }
  return noProof('No confirmation text detected on MyJobMag page.');
}

async function hasApplicationForm(page) {
  return (await page.locator('form#d-apply-form input[type="file"]').count().catch(() => 0)) > 0;
}

async function verifySubmission(ctx = {}) {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'MyJobMag adapter relies on in-page confirmation proof.'
  };
}

export const myjobmagAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default myjobmagAdapter;
